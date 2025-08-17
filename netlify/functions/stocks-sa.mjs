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
    // رموز افتراضية: أرامكو، سابك، STC، الراجحي، الأهلي السعودي، المراعي + المؤشر العام
    const defaultSymbols = ["2222.SR","2010.SR","7010.SR","1120.SR","1180.SR","2280.SR","^TASI"];
    const symbols = (qs.get("symbols") || defaultSymbols.join(","))
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    // مهم: لا نعمل encode للـ commas
    const url = "https://query1.finance.yahoo.com/v7/finance/quote?symbols=" + symbols.join(",");
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "application/json"
      }
    });

    if (!r.ok) {
      return {
        statusCode: r.status,
        headers: { ...baseHeaders, "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ error: true, upstreamStatus: r.status })
      };
    }
    const j = await r.json();
    const rows = (j?.quoteResponse?.result || []).map(q => ({
      symbol: q.symbol,
      name: q.shortName || q.longName || q.symbol,
      price: Number(q.regularMarketPrice ?? q.postMarketPrice ?? 0),
      change: Number(q.regularMarketChange ?? 0),
      change_percent: Number(q.regularMarketChangePercent ?? 0),
      currency: q.currency || "SAR",
      market_time: q.regularMarketTime || null
    }));

    return {
      statusCode: 200,
      headers: {
        ...baseHeaders,
        "Content-Type": "application/json; charset=utf-8",
        // كاش أقصر للأسهم (دقيقة واحدة)
        "Netlify-CDN-Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
        "Cache-Control": "public, max-age=30"
      },
      body: JSON.stringify({ ok: true, count: rows.length, data: rows })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: baseHeaders,
      body: JSON.stringify({ error: true, message: e?.message || "stocks failed" })
    };
  }
};
