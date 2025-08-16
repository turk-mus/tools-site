// netlify/functions/revgeo.mjs
export const handler = async (event) => {
  const baseHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: baseHeaders, body: "" };
  }

  const qs = event.queryStringParameters || {};
  if (qs.ping === "1") {
    return { statusCode: 200, headers: { ...baseHeaders, "Content-Type":"application/json; charset=utf-8" }, body: JSON.stringify({ ok:true, msg:"revgeo alive" }) };
  }

  try {
    const { lat, lon, lang = "ar" } = qs;
    if (!lat || !lon) {
      return { statusCode: 400, headers: baseHeaders, body: '{"error":"lat & lon required"}' };
    }

    // 1) المزوّد الأساسي (Open-Meteo) + format=json صراحةً
    const primaryURL =
      `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&language=${encodeURIComponent(lang)}&format=json`;

    let resp = await fetch(primaryURL, { headers: { "Accept": "application/json" } });
    let text = await resp.text();

    let results = null;
    if (resp.ok) {
      try {
        const j = JSON.parse(text);
        if (Array.isArray(j?.results) && j.results.length) {
          results = j.results;
        }
      } catch { /* ignore */ }
    }

    // 2) إن فشلنا أو 404، نستخدم Nominatim كـ fallback
    if (!results) {
      const fallbackURL =
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&accept-language=${encodeURIComponent(lang)}`;
      const fb = await fetch(fallbackURL, {
        headers: {
          "Accept": "application/json",
          // Nominatim يتطلب User-Agent واضح
          "User-Agent": "as3aralywm.com (revgeo function)"
        }
      });
      const fbTxt = await fb.text();
      if (fb.ok) {
        try {
          const j = JSON.parse(fbTxt);
          if (j && j.address) {
            const a = j.address || {};
            // نحولها لشكل قريب من Open-Meteo
            results = [{
              name: j.name || j.display_name?.split(",")[0] || a.city || a.town || a.village || a.suburb || a.neighbourhood,
              admin1: a.state || a.region || a.county,
              country: a.country
            }].filter(x => x.name);
          }
        } catch { /* ignore */ }
      }
    }

    // 3) الردّ الموحّد
    const out = { results: Array.isArray(results) ? results : [] };
    return {
      statusCode: 200,
      headers: {
        ...baseHeaders,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300"
      },
      body: JSON.stringify(out)
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: baseHeaders,
      body: JSON.stringify({ error: e?.message || "revgeo failed" })
    };
  }
};
