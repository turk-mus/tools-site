export const handler = async (event) => {
  const baseHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: baseHeaders, body: "" };
  }
  if (event.queryStringParameters?.ping === "1") {
    return {
      statusCode: 200,
      headers: { ...baseHeaders, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ ok: true, msg: "revgeo alive" })
    };
  }

  try {
    const { lat, lon, lang = "ar" } = event.queryStringParameters || {};
    if (!lat || !lon) {
      return { statusCode: 400, headers: baseHeaders, body: '{"error":"lat & lon required"}' };
    }

    const url = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&language=${encodeURIComponent(lang)}`;
    const r   = await fetch(url);
    const txt = await r.text();

    // نحاول تحويل الرد لـ JSON، ولو ما ينفع نخليه نص
    let parsed = null;
    try { parsed = JSON.parse(txt); } catch { /* ignore */ }

    return {
      statusCode: 200, // 👈 نخليها 200 عشان نشوف تفاصيل المزود بدل ما يرجع 404 للمتصفح
      headers: {
        ...baseHeaders,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300"
      },
      body: JSON.stringify({
        upstreamStatus: r.status,
        upstreamOk: r.ok,
        upstreamContentType: r.headers.get("content-type"),
        data: parsed ?? null,
        text: parsed ? undefined : txt
      })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: baseHeaders,
      body: JSON.stringify({ error: e?.message || "revgeo failed" })
    };
  }
};
