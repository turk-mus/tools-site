// netlify/functions/stocks-sa.mjs
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
    const qs = new URLSearchParams(event.queryStringParameters || {});
    const symbols = (qs.get("symbols") || "")
      .split(",").map(s => s.trim()).filter(Boolean);
    if (!symbols.length) {
      return { statusCode: 400, headers: baseHeaders,
        body: JSON.stringify({ error: "symbols required" }) };
    }

    const KEY = process.env.EODHD_API_KEY || qs.get("key"); // key=... للاختبار فقط
    if (!KEY) {
      return { statusCode: 500, headers: baseHeaders,
        body: JSON.stringify({ error: "missing EODHD_API_KEY" }) };
    }

    const fetchOne = async (sym) => {
      const url = `https://eodhd.com/api/real-time/${encodeURIComponent(sym)}?api_token=${encodeURIComponent(KEY)}&fmt=json`;
      const r = await fetch(url, { headers: { "User-Agent": "as3aralywm/1.0" } });
      const txt = await r.text();
      let data; try { data = JSON.parse(txt); } catch {}
      if (!r.ok) return { symbol: sym, ok: false, upstreamStatus: r.status, data: data || txt };
      return {
        symbol: sym, ok: true,
        price: data?.close, changePct: data?.change_p, raw: data
      };
    };

    const out = await Promise.all(symbols.map(fetchOne));
    return {
      statusCode: 200,
      headers: {
        ...baseHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=30",
      },
      body: JSON.stringify(out),
    };
  } catch (e) {
    return { statusCode: 500, headers: baseHeaders,
      body: JSON.stringify({ error: e?.message || "stocks-sa failed" }) };
  }
};
