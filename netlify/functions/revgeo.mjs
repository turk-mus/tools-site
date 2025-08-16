// netlify/functions/revgeo.mjs
const VERSION = "2.0";

export const handler = async (event) => {
  const baseHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "X-Revgeo-Version": VERSION,
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: baseHeaders, body: "" };
  }

  const qs = event.queryStringParameters || {};
  if (qs.ping === "1") {
    return {
      statusCode: 200,
      headers: { ...baseHeaders, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ ok: true, msg: "revgeo alive", version: VERSION })
    };
  }

  try {
    const { lat, lon, lang = "ar" } = qs;
    if (!lat || !lon) {
      return { statusCode: 400, headers: baseHeaders, body: '{"error":"lat & lon required"}' };
    }

    // محاولة أولى: Open-Meteo (مع format=json)
    let results = null;
    try {
      const url1 = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&language=${encodeURIComponent(lang)}&format=json`;
      const r1 = await fetch(url1, { headers: { "Accept":"application/json" } });
      if (r1.ok) {
        const j1 = await r1.json();
        if (Array.isArray(j1?.results) && j1.results.length) {
          results = j1.results;
        }
      }
    } catch {}

    // فولباك: Nominatim
    if (!results) {
      try {
        const url2 = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&accept-language=${encodeURIComponent(lang)}`;
        const r2 = await fetch(url2, {
          headers: {
            "Accept":"application/json",
            "User-Agent":"as3aralywm.com (revgeo)"
          }
        });
        if (r2.ok) {
          const j2 = await r2.json();
          const a = j2.address || {};
          const name = j2.name || (j2.display_name ? j2.display_name.split(",")[0] : null) || a.city || a.town || a.village || a.suburb || a.neighbourhood;
          if (name) {
            results = [{ name, admin1: a.state || a.region || a.county || null, country: a.country || null }];
          }
        }
      } catch {}
    }

    return {
      statusCode: 200,
      headers: { ...baseHeaders, "Content-Type":"application/json; charset=utf-8", "Cache-Control":"public, max-age=300" },
      body: JSON.stringify({ version: VERSION, results: Array.isArray(results) ? results : [] })
    };
  } catch (e) {
    return { statusCode: 500, headers: baseHeaders, body: JSON.stringify({ error: e?.message || "revgeo failed", version: VERSION }) };
  }
};
