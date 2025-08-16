// Proxy لـ Open-Meteo reverse geocoding مع CORS
export const handler = async (event) => {
  try {
    const qs = new URLSearchParams(event.queryStringParameters || {});
    const lat = qs.get("lat");
    const lon = qs.get("lon");
    const lang = qs.get("lang") || "ar";
    if (!lat || !lon) {
      return { statusCode: 400, headers: { "Access-Control-Allow-Origin": "*" }, body: '{"error":"lat & lon required"}' };
    }

    const url = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&language=${encodeURIComponent(lang)}`;
    const res = await fetch(url);
    const text = await res.text();

    return {
      statusCode: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") || "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300"
      },
      body: text
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: e.message })
    };
  }
};
