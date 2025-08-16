// netlify/functions/x-trends.mjs
// RapidAPI (twitter-trends-api.p.rapidapi.com) مع كاش قوي + fallback عند 429
// - كاش بالذاكرة + ملف كاش في /tmp (يبقى طوال عمر الحاوية)
// - إن جاء 429 نرجع آخر نسخة مخزنة بدل ما نفشل
// - قلّل عدد الطلبات فعليًا للمزوّد

const RAPID_HOST = "twitter-trends-api.p.rapidapi.com";
const WOEID_SA = 23424938;

// اضبط المدد حسب خطتك
const CACHE_TTL_MS     = 30 * 60 * 1000; // 30 دقيقة: مدة صلاحية الكاش "الجديد"
const STALE_TTL_MS     = 2  * 60 * 60 * 1000; // ساعتان: نسمح بإرجاع بيانات قديمة عند 429
const FILE_CACHE_PATH  = "/tmp/xtrends-cache.json";

let memoryCache = { key: "", ts: 0, data: null };
let inflightPromise = null; // لمنع تعدد الجلب المتوازي

const BAD_PATTERNS = [
  /اباح|جنس|جنسي|xxx|سكس|قذر|قذاره|شتم|سّ?ب|عنصري|كراهيه|مخدر|انتحار|ارهاب/i,
  /nsfw|18\+|sex|porn|hate|racis|terror/i,
  /http[s]?:\/\//i
];

function normalizeArabic(s = "") {
  return s
    .replace(/[\u0610-\u061A\u064B-\u065F\u06D6-\u06ED]/g, "")
    .replace(/[إأآا]/g, "ا").replace(/ى/g, "ي").replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي").replace(/ة/g, "ه").trim();
}
function isClean(name = "") {
  const n = normalizeArabic(name);
  if (!n || n.length < 2) return false;
  return !BAD_PATTERNS.some(rx => rx.test(n));
}

async function readFileCache() {
  try {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(FILE_CACHE_PATH, "utf8");
    return JSON.parse(raw);
  } catch { return null; }
}
async function writeFileCache(payload) {
  try {
    const fs = await import("node:fs/promises");
    await fs.writeFile(FILE_CACHE_PATH, JSON.stringify(payload), "utf8");
  } catch {}
}

async function fetchFromRapid(woeid, rapidKey) {
  const url = `https://${RAPID_HOST}/trends?woeid=${woeid}`;
  const r = await fetch(url, {
    headers: {
      "x-rapidapi-key": rapidKey,
      "x-rapidapi-host": RAPID_HOST
    }
  });
  const status = r.status;
  const text = await r.text();
  if (status === 200) {
    const json = JSON.parse(text);
    const items = json?.trends || json?.data || json?.[0]?.trends || json || [];
    const trends = (Array.isArray(items) ? items : [])
      .map(t => {
        const name = t.name || t.title || t.topic || t.hashtag || "";
        const tweet_volume = t.tweet_volume ?? t.volume ?? t.count ?? t.tweets ?? 0;
        const promoted = !!t.promoted || !!t.promoted_content || !!t.isPromoted;
        return { name, tweet_volume, promoted };
      })
      .filter(t => t.name)
      .filter(t => !t.promoted)
      .filter(t => isClean(t.name))
      .sort((a, b) => (b.tweet_volume || 0) - (a.tweet_volume || 0));
    return { ok: true, trends };
  }
  return { ok: false, status, body: text };
}

export const handler = async (event) => {
  const rapidKey = process.env.RAPIDAPI_KEY;
  if (!rapidKey) {
    return { statusCode: 500, body: "RAPIDAPI_KEY مفقود في متغيرات البيئة" };
  }

  const qs = new URLSearchParams(event.queryStringParameters || {});
  const limit = Math.max(1, Math.min(50, Number(qs.get("limit") || 10)));
  const woeid = Number(qs.get("woeid") || WOEID_SA);
  const cacheKey = `woeid:${woeid}`;

  // 1) كاش الذاكرة
  if (memoryCache.data && memoryCache.key === cacheKey) {
    const age = Date.now() - memoryCache.ts;
    if (age < CACHE_TTL_MS) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60", "X-Cache": "memory-fresh" },
        body: JSON.stringify(memoryCache.data.slice(0, limit))
      };
    }
  }

  // 2) كاش الملف (/tmp)
  const fileCache = await readFileCache();
  if (fileCache && fileCache.key === cacheKey) {
    const age = Date.now() - fileCache.ts;
    if (age < CACHE_TTL_MS) {
      // جديد بما يكفي
      memoryCache = fileCache;
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60", "X-Cache": "file-fresh" },
        body: JSON.stringify(fileCache.data.slice(0, limit))
      };
    }
  }

  // 3) منع الجلب المتوازي (thundering herd)
  if (!inflightPromise) {
    inflightPromise = (async () => {
      const res = await fetchFromRapid(woeid, rapidKey);
      inflightPromise = null;
      if (res.ok) {
        const top = res.trends.slice(0, limit);
        const payload = { key: cacheKey, ts: Date.now(), data: res.trends };
        memoryCache = payload;
        await writeFileCache(payload);
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60", "X-Cache": "fetched" },
          body: JSON.stringify(top)
        };
      }

      // 429 أو أي خطأ: إن عندنا بيانات قديمة ≤ STALE_TTL_MS نرجعها (SWR)
      const stale = memoryCache.key === cacheKey ? memoryCache
                  : (fileCache && fileCache.key === cacheKey ? fileCache : null);
      if (stale && (Date.now() - stale.ts) < STALE_TTL_MS) {
        return {
          statusCode: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=60",
            "X-Cache": "stale",
            "X-Upstream-Status": String(res.status || "")
          },
          body: JSON.stringify(stale.data.slice(0, limit))
        };
      }

      // لا يوجد كاش صالح: رجّع رسالة مفيدة مع Retry-After
      const body = res.body || "";
      return {
        statusCode: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "120" },
        body: `Upstream rate limited (429). لا توجد بيانات مخزنة حالياً.\n${body}`
      };
    })();
  }

  return inflightPromise;
};
