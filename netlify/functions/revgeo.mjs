// revgeo.mjs
export const handler = async (event) => {
  const baseHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: baseHeaders, body: "" };
  }

  try {
    const { lat, lon, lang = "ar" } = event.queryStringParameters || {};
    if (!lat || !lon) {
      return {
        statusCode: 400,
        headers: baseHeaders,
        body: '{"error":"lat & lon required"}'
      };
    }

    const url = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&language=${encodeURIComponent(lang)}`;
    const r   = await fetch(url);
    const txt = await r.text();

    return {
      statusCode: r.status,
      headers: {
        ...baseHeaders,
        "Content-Type": r.headers.get("content-type") || "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300"
      },
      body: txt
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: baseHeaders,
      body: JSON.stringify({ error: e?.message || "revgeo failed" })
    };
  }
};
