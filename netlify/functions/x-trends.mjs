// netlify/functions/x-trends.mjs
// ✔ يعمل على Netlify Functions (Node 18+) بدون node-fetch
// ✔ يتصل بـ RapidAPI (twitter-trends-by-location)
// ✔ يدعم إيجاد معرّف السعودية تلقائيًا من "available locations"
// ✔ تصفية الكلمات المسيئة + كاش 15 دقيقة لتقليل الاستهلاك

const RAPID_HOST = "twitter-trends-by-location.p.rapidapi.com";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 دقيقة كاش بالذاكرة
let memoryCache = { key: "", ts: 0, data: null };

// قائمة تصفية أولية (تقدر توسّعها لاحقًا)
const BAD_PATTERNS = [
  /اباح|جنس|جنسي|xxx|سكس|قذر|قذاره|شتم|سّ?ب|عنصري|كراهيه|مخدر|انتحار|ارهاب/i,
  /nsfw|18\+|sex|porn|hate|racis|terror/i,
  /http[s]?:\/\//i
];

function normalizeArabic(s = "") {
  return s
    .replace(/[\u0610-\u061A\u064B-\u065F\u06D6-\u06ED]/g, "") // إزالة التشكيل
    .replace(/[إأآا]/g, "ا").replace(/ى/g, "ي").replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي").replace(/ة/g, "ه").trim();
}
function isClean(name = "") {
  const n = normalizeArabic(name);
  if (!n || n.length < 2) return false;
  return !BAD_PATTERNS.some(rx => rx.test(n));
}

// جلب قائمة المواقع من المزود ثم إيجاد السعودية
async function getSaudiLocationId(rapidKey) {
  const url = `https://${RAPID_HOST}/locations`;
  const r = await fetch(url, {
    headers: {
      "x-rapidapi-key": rapidKey,
      "x-rapidapi-host": RAPID_HOST
    }
  });
  if (!r.ok) throw new Error(`locations error: ${r.status}`);
  const list = await r.json();
  // نحاول بعدة طرق
  const byCode = list.find(x =>
    (x.countryCode || x.country_code || "").toUpperCase() === "SA"
  );
  if (byCode?.id) return byCode.id;

  const byName = list.find(x => {
    const n = (x.name || x.country || "").toString().toLowerCase();
    return n.includes("saudi") || n.includes("السعود");
  });
  if (byName?.id) return byName.id;

  // كخيار أخير: ويفيد إذا عرفت المعرّف مسبقًا
  throw new Error("لم أجد معرّف السعودية في available locations");
}

// جلب الترندات لمعرّف موقع محدد
async function fetchTrendsByLocationId(rapidKey, locationId) {
  const url = `https://${RAPID_HOST}/location/${encodeURIComponent(locationId)}`;
  const r = await fetch(url, {
    headers: {
      "x-rapidapi-key": rapidKey,
      "x-rapidapi-host": RAPID_HOST
    }
  });
  if (!r.ok) throw new Error(`location error: ${r.status}`);
  const json = await r.json();

  // نحاول قراءة الصيغة مهما اختلفت
  const items =
    json?.trends ||
    json?.data ||
    json?.topics ||
    json?.[0]?.trends ||
    json ||
    [];

  const trends = (Array.isArray(items) ? items : [])
    .map(t => {
      const name = t.name || t.title || t.topic || t.hashtag || "";
      const tweet_volume =
        t.tweet_volume ?? t.volume ?? t.count ?? t.tweets ?? 0;
      const promoted =
        !!t.promoted_content || !!t.promoted || !!t.isPromoted;
      return { name, tweet_volume, promoted };
    })
    .filter(t => t.name)
    .filter(t => !t.promoted)
    .filter(t => isClean(t.name))
    .sort((a, b) => (b.tweet_volume || 0) - (a.tweet_volume || 0));

  return trends;
}

export async function handler(event) {
  try {
    const rapidKey = process.env.RAPIDAPI_KEY;
    if (!rapidKey) {
      return { statusCode: 500, body: "RAPIDAPI_KEY مفقود في متغيرات البيئة" };
    }

    const qs = new URLSearchParams(event.queryStringParameters || {});
    const limit = Math.max(1, Math.min(50, Number(qs.get("limit") || 10)));
    const country = (qs.get("country") || "SA").toUpperCase();
    const locationIdParam = qs.get("locationId"); // إذا كنت تعرف الـID مباشرةً

    // مفتاح الكاش يعتمد على القيم
    const cacheKey = `${country}:${locationIdParam}:${limit}`;
    if (memoryCache.data && memoryCache.key === cacheKey &&
        Date.now() - memoryCache.ts < CACHE_TTL_MS) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
        body: JSON.stringify(memoryCache.data.slice(0, limit))
      };
    }

    // حدد المعرّف
    const locationId = locationIdParam || await getSaudiLocationId(rapidKey);
    const trends = await fetchTrendsByLocationId(rapidKey, locationId);
    const top = trends.slice(0, limit);

    // خزّن بالكاش
    memoryCache = { key: cacheKey, ts: Date.now(), data: top };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
      body: JSON.stringify(top)
    };
  } catch (e) {
    return { statusCode: 500, body: `Server error: ${e.message}` };
  }
}

export default { handler };
