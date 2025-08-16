// RapidAPI provider: twitter-trends5.p.rapidapi.com (اضبط TRENDS_HOST في البيئة)
// Endpoint: POST /twitter/request.php (form-urlencoded)
// يرجع مصفوفة [{ name, tweet_volume }, ...] مع تصفية وكاش 30 دقيقة

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 دقيقة
let memoryCache = { ts: 0, data: [] };

const BAD_PATTERNS = [
  /اباح|جنس|جنسي|xxx|سكس|قذر|قذاره|شتم|سّ?ب|عنصري|كراهيه|مخدر|انتحار|ارهاب/i,
  /nsfw|18\+|sex|porn|hate|racis|terror/i,
  /http[s]?:\/\//i
];

// تبسيط تطبيع العربية (بدون تشدد)
function normalizeArabic(s = "") {
  return s
    .replace(/[\u0610-\u061A\u064B-\u065F\u06D6-\u06ED]/g, "") // حركات
    .replace(/[إأآا]/g, "ا").replace(/ى/g, "ي").replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي").replace(/ة/g, "ه")
    .trim();
}

function isClean(name = "") {
  const n = normalizeArabic(name);
  if (!n || n.length < 2) return false;
  return !BAD_PATTERNS.some(rx => rx.test(n));
}

function toArrayMaybe(objOrArr) {
  if (!objOrArr) return [];
  if (Array.isArray(objOrArr)) return objOrArr;
  if (typeof objOrArr === "object") {
    // {0:{},1:{},...} -> array
    return Object.keys(objOrArr)
      .sort((a, b) => +a - +b)
      .map(k => objOrArr[k]);
  }
  return [];
}

// محاولات استخراج الاسم من حقول شائعة
function pickName(t = {}) {
  let name =
    t.name ||
    t.title ||
    t.hashtag ||
    t.topic ||
    t.query ||
    "";

  // لو كانت query مثل "search?q=Putin" حاول نطلع الجزء بعد q=
  if (!name && typeof t.query === "string") {
    try {
      const u = new URL("https://x.com/?" + t.query);
      name = u.searchParams.get("q") || "";
    } catch {/* ignore */}
  }

  if (typeof name === "string") {
    name = name.trim();
    // تأكد أن يبدأ بـ# لو هو وسماً بدون #
    if (name && !name.startsWith("#") && !name.includes(" ")) {
      name = "#" + name;
    }
  }
  return name;
}

export const handler = async (event) => {
  try {
    const key  = process.env.RAPIDAPI_KEY;
    const host = process.env.TRENDS_HOST; // twitter-trends5.p.rapidapi.com
    if (!key)  return { statusCode: 500, body: "RAPIDAPI_KEY مفقود" };
    if (!host) return { statusCode: 500, body: "TRENDS_HOST مفقود" };

    const qs = new URLSearchParams(event.queryStringParameters || {});
    const limit   = Math.max(1, Math.min(50, Number(qs.get("limit") || 10)));
    const woeid   = qs.get("woeid")   || "23424938"; // السعودية
    const country = qs.get("country") || "sa";
    const lang    = qs.get("lang")    || "ar";

    // كاش بسيط بالذاكرة
    if (memoryCache.data.length && Date.now() - memoryCache.ts < CACHE_TTL_MS) {
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=60",
          "X-Cache": "memory"
        },
        body: JSON.stringify(memoryCache.data.slice(0, limit))
      };
    }

    // بناء الطلب (نعطي أكثر من إشارة للموقع)
    const url = `https://${host}/twitter/request.php`;
    const form = new URLSearchParams({
      // بعض المزودين يفهم woeid، بعضهم country/lang؛ نرسل الكل
      woeid,                 // 23424938 = KSA
      country,               // "sa"
      lang                   // "ar"
      // أضف حقولاً أخرى لو وثائق المزود تطلب ذلك
    });

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "x-rapidapi-key": key,
        "x-rapidapi-host": host
      },
      body: form
    });

    const text = await r.text();
    if (!r.ok) {
      return { statusCode: r.status, body: `RapidAPI error: ${r.status} ${text}` };
    }

    let json = {};
    try { json = JSON.parse(text); } catch { json = {}; }

    // تراكيب شائعة: { trends: [...] } أو { trends: {0:{},1:{}} } أو { data: [...] } أو مصفوفة مباشرة
    const raw = toArrayMaybe(json.trends || json.data || json);

    const trends = raw
      .map(t => {
        const name = pickName(t);
        const tweet_volume = t.volume ?? t.tweet_volume ?? t.count ?? 0;
        const promoted = !!t.promoted || !!t.promoted_content || !!t.isPromoted;
        return { name, tweet_volume, promoted };
      })
      .filter(t => t.name)         // لازم اسم
      .filter(t => !t.promoted)    // استبعد المروّج
      .filter(t => isClean(t.name))
      .sort((a, b) => (b.tweet_volume || 0) - (a.tweet_volume || 0));

    memoryCache = { ts: Date.now(), data: trends };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60"
      },
      body: JSON.stringify(trends.slice(0, limit))
    };
  } catch (e) {
    return { statusCode: 500, body: `Server error: ${e.message}` };
  }
};
