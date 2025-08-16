// RapidAPI provider: twitter-trends5.p.rapidapi.com  (يُضبط من البيئة TRENDS_HOST)
// Endpoint: POST /twitter/request.php (حسب الكود سنبت)
// يرجّع مصفوفة [{ name, tweet_volume }, ...] مع تصفية وكاش 30 دقيقة

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 دقيقة
let memoryCache = { ts: 0, data: [] };

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
function toArrayMaybe(objOrArr) {
  if (!objOrArr) return [];
  if (Array.isArray(objOrArr)) return objOrArr;
  if (typeof objOrArr === "object")
    return Object.keys(objOrArr).sort((a,b)=>+a-+b).map(k=>objOrArr[k]);
  return [];
}

export const handler = async (event) => {
  try {
    const key = process.env.RAPIDAPI_KEY;
    const host = process.env.TRENDS_HOST; // يجب ضبطه في Netlify: twitter-trends5.p.rapidapi.com
    if (!key)  return { statusCode: 500, body: "RAPIDAPI_KEY مفقود" };
    if (!host) return { statusCode: 500, body: "TRENDS_HOST مفقود" };

    const qs = new URLSearchParams(event.queryStringParameters || {});
    const limit = Math.max(1, Math.min(50, Number(qs.get("limit") || 10)));

    // كاش
    if (memoryCache.data.length && Date.now() - memoryCache.ts < CACHE_TTL_MS) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60", "X-Cache": "memory" },
        body: JSON.stringify(memoryCache.data.slice(0, limit))
      };
    }

    // حسب الكود سنبت: POST مع form-urlencoded إلى /twitter/request.php
    const url = `https://${host}/twitter/request.php`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "x-rapidapi-key": key,
        "x-rapidapi-host": host
      },
      body: new URLSearchParams({
        // إذا كان الـAPI يقبل بارامترات إضافية ضعها هنا (مثلاً: country/lang…)
        // اتركها فارغة الآن
      })
    });

    const text = await r.text();
    if (!r.ok) {
      return { statusCode: r.status, body: `RapidAPI error: ${r.status} ${text}` };
    }

    let json = {};
    try { json = JSON.parse(text); } catch {}
    // بعض المزوّدين يرجعون { trends: {0:{...},1:{...}} } أو { trends: [...] }
    const raw = toArrayMaybe(json.trends || json.data || json);

    const trends = raw
      .map(t => {
        const name = t.name || t.title || t.query || t.hashtag || "";
        const tweet_volume = t.volume ?? t.tweet_volume ?? 0;
        const promoted = !!t.promoted || !!(t.promoted_content) || !!t.isPromoted;
        return { name, tweet_volume, promoted };
      })
      .filter(t => t.name)
      .filter(t => !t.promoted)
      .filter(t => isClean(t.name))
      .sort((a,b) => (b.tweet_volume||0) - (a.tweet_volume||0));

    memoryCache = { ts: Date.now(), data: trends };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
      body: JSON.stringify(trends.slice(0, limit))
    };
  } catch (e) {
    return { statusCode: 500, body: `Server error: ${e.message}` };
  }
};
