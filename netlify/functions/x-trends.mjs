// netlify/functions/x-trends.mjs
// مزوّد RapidAPI: twitter-trends-api (مسار واحد بالـ WOEID)
// السعودية WOEID = 23424938
// يشمل تصفية كلمات مسيئة + كاش 15 دقيقة

const RAPID_HOST = "twitter-trends-api.p.rapidapi.com";
const WOEID_SA = 23424938;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 دقيقة
let memoryCache = { key: "", ts: 0, data: null };

// وسّعها لاحقًا حسب حاجتك
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

export const handler = async (event) => {
  try {
    const rapidKey = process.env.RAPIDAPI_KEY;
    if (!rapidKey) {
      return { statusCode: 500, body: "RAPIDAPI_KEY مفقود في متغيرات البيئة" };
    }

    const qs = new URLSearchParams(event.queryStringParameters || {});
    const limit = Math.max(1, Math.min(50, Number(qs.get("limit") || 10)));
    const woeid = Number(qs.get("woeid") || WOEID_SA);

    const cacheKey = `woeid:${woeid}:limit:${limit}`;
    if (memoryCache.data && memoryCache.key === cacheKey &&
        Date.now() - memoryCache.ts < CACHE_TTL_MS) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
        body: JSON.stringify(memoryCache.data.slice(0, limit)),
      };
    }

    const url = `https://${RAPID_HOST}/trends?woeid=${woeid}`;
    const r = await fetch(url, {
      headers: {
        "x-rapidapi-key": rapidKey,
        "x-rapidapi-host": RAPID_HOST
      }
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return { statusCode: r.status, body: `RapidAPI error: ${r.status} ${text}` };
    }

    const json = await r.json();

    // محاولة مرنة لاستخراج العناصر بغض النظر عن شكل الاستجابة
    const itemsRaw = json?.trends || json?.data || json?.[0]?.trends || json || [];
    const trends = (Array.isArray(itemsRaw) ? itemsRaw : [])
      .map(t => {
        const name = t.name || t.title || t.topic || t.hashtag || "";
        const tweet_volume = t.tweet_volume ?? t.volume ?? t.count ?? t.tweets ?? 0;
        const promoted = !!t.promoted || !!t.promoted_content || !!t.isPromoted;
        return { name, tweet_volume, promoted };
      })
      .filter(t => t.name)
      .filter(t => !t.promoted)
      .filter(t => isClean(t.name))
      .sort((a, b) => (b.tweet_volume || 0) - (a.tweet_volume || 0))
      .slice(0, limit);

    memoryCache = { key: cacheKey, ts: Date.now(), data: trends };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
      body: JSON.stringify(trends)
    };
  } catch (e) {
    return { statusCode: 500, body: `Server error: ${e.message}` };
  }
};
