// /netlify/functions/x-trends.mjs
// ملاحظة: Netlify (Node 18+) فيه fetch مدمج، ما نحتاج node-fetch

const HOST = "twitter-trends-by-location.p.rapidapi.com";
// هذا هو المعرّف الظاهر لك في RapidAPI (من لقطة الشاشة)
const LOCATION_ID = "f719fcd7bc333af4b3d78d0e65893e5e";

// كلمات محظورة مبدئية
const BLOCKED = ["adult","porn","xxx","nude","sex","nsfw","racist","terror","اباحي","خلاعة","قذر","وسخ","لعنة"];

function normalize(list) {
  return (Array.isArray(list) ? list : [])
    .map((it) => {
      const name = (it.name || it.title || it.hashtag || it.topic || "").toString().trim();
      const url = it.url || it.link || null;
      const vol = it.tweet_volume ?? it.volume ?? it.count ?? null;
      return { name, url, tweet_volume: vol };
    })
    .filter((it) => it.name && !BLOCKED.some((b) => it.name.toLowerCase().includes(b)));
}

export const handler = async (event) => {
  try {
    if (!process.env.RAPIDAPI_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing RAPIDAPI_KEY env" }) };
    }

    // استدعاء مباشر: /location/{id}
    const res = await fetch(`https://${HOST}/location/${LOCATION_ID}`, {
      headers: {
        "X-RapidAPI-Key": process.env.RAPIDAPI_KEY,
        "X-RapidAPI-Host": HOST,
      },
    });

    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }

    // وضع debug: /.netlify/functions/x-trends?debug=1
    if (event?.queryStringParameters?.debug === "1") {
      return {
        statusCode: res.status,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ status: res.status, raw: data }, null, 2),
      };
    }

    if (!res.ok) {
      return {
        statusCode: res.status,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ error: "Upstream error", status: res.status, raw: data }, null, 2),
      };
    }

    // حاول التقاط المصفوفة من حقول شائعة
    const arr =
      Array.isArray(data) ? data :
      Array.isArray(data.trends) ? data.trends :
      Array.isArray(data.data) ? data.data :
      Array.isArray(data.hashtags) ? data.hashtags :
      Array.isArray(data.items) ? data.items :
      Array.isArray(data.records) ? data.records :
      Array.isArray(data.location?.trends) ? data.location.trends :
      [];

    const trends = normalize(arr);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=600",
      },
      body: JSON.stringify({
        updated_at: new Date().toISOString(),
        location_id: LOCATION_ID,
        count: trends.length,
        trends,
      }),
    };
  } catch (e) {
    return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: e.message }) };
  }
};
