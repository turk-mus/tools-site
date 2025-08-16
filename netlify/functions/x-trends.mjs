// /netlify/functions/x-trends.mjs
import fetch from "node-fetch";

// مزود RapidAPI الذي اخترته (من صورتك)
const HOST = "twitter-trends-by-location.p.rapidapi.com";

// اسم البلد الذي نبي نطلّع ترنده
const COUNTRY_NAME = "Saudi Arabia";

// كلمات محظورة مبدئية (طوّرها لاحقاً)
const BLOCKED = ["adult","porn","xxx","nude","sex","nsfw","racist","terror","اباحي","خلاعة","قذر","وسخ","لعنة"];

// دالة مساعدة للطلبات
async function rapidGet(path) {
  const url = `https://${HOST}${path}`;
  const res = await fetch(url, {
    headers: {
      "X-RapidAPI-Key": process.env.RAPIDAPI_KEY,
      "X-RapidAPI-Host": HOST,
    },
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

// جلب معرّف موقع السعودية من endpoint "Get available locations"
async function getSaudiLocationId() {
  // عادة يكون المسار /locations (مذكور في الشريط اليسار عندك)
  const { ok, status, data } = await rapidGet("/locations");
  if (!ok) throw new Error(`locations error ${status}: ${JSON.stringify(data)}`);

  // ابحث عن Saudi Arabia (أحياناً name أو country_name)
  const list = Array.isArray(data) ? data : (data.locations || data.data || []);
  const match = list.find(
    (x) =>
      (x.name && x.name.toLowerCase() === COUNTRY_NAME.toLowerCase()) ||
      (x.country_name && x.country_name.toLowerCase() === COUNTRY_NAME.toLowerCase())
  );

  if (!match?.id) {
    // لو ما وجدناها، جرّب أقرب تطابق
    const fuzzy = list.find(
      (x) =>
        (x.name && x.name.toLowerCase().includes("saudi")) ||
        (x.country_name && x.country_name.toLowerCase().includes("saudi"))
    );
    if (!fuzzy?.id) {
      throw new Error("Saudi Arabia location id not found in /locations response");
    }
    return fuzzy.id;
  }
  return match.id;
}

function normalizeAndFilterTrends(raw) {
  const arr =
    Array.isArray(raw) ? raw :
    raw?.trends && Array.isArray(raw.trends) ? raw.trends :
    raw?.data && Array.isArray(raw.data) ? raw.data :
    [];

  return arr
    .map((it) => {
      const name = (it.name || it.title || "").trim();
      return {
        name,
        url: it.url || null,
        tweet_volume: it.tweet_volume ?? it.volume ?? null,
      };
    })
    .filter((it) => it.name)
    .filter((it) => !BLOCKED.some((bad) => it.name.toLowerCase().includes(bad)));
}

export const handler = async (event) => {
  try {
    const debug = event?.queryStringParameters?.debug === "1";

    // 1) جيب Location ID للسعودية
    const locationId = await getSaudiLocationId();

    // 2) جيب الترندات لهذا الموقع
    // من صورتك، الـ endpoint المعروض لِـ "Get trending hashtags / topics for location"
    // شكله: /location/{id}
    const { ok, status, data } = await rapidGet(`/location/${locationId}`);

    if (debug) {
      return {
        statusCode: status,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ status, locationId, raw: data }, null, 2),
      };
    }

    if (!ok) {
      return {
        statusCode: status,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ error: "Upstream error", status, raw: data }, null, 2),
      };
    }

    const trends = normalizeAndFilterTrends(data);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=600",
      },
      body: JSON.stringify({
        updated_at: new Date().toISOString(),
        country: "SA",
        location_id: locationId,
        count: trends.length,
        trends,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: e.message }),
    };
  }
};
