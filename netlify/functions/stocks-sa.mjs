// netlify/functions/stocks-sa.mjs
export const handler = async (event) => {
  const baseHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    // كاش على طبقة CDN (Netlify Edge)
    "Netlify-CDN-Cache-Control": "public, s-maxage=180, stale-while-revalidate=60",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: baseHeaders, body: "" };
  }

  try {
    const qs = event.queryStringParameters || {};
    const symbols = (qs.symbols || "2222.SR,2010.SR,7010.SR,1120.SR,1180.SR,2280.SR,^TASI")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .join(",");

    if (!symbols) {
      return { statusCode: 400, headers: baseHeaders, body: '{"error":"symbols required"}' };
    }

    const url =
      "https://query1.finance.yahoo.com/v7/finance/quote?lang=ar-SA&region=SA&symbols=" +
      encodeURIComponent(symbols);

    const r = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; as3aralywm/1.0; +https://as3aralywm.com)"
      }
    });

    const txt = await r.text();
    if (!r.ok) {
      return {
        statusCode: 502,
        headers: baseHeaders,
        body: JSON.stringify({ error: true, upstream: r.status, body: txt.slice(0, 500) })
      };
    }

    const j = JSON.parse(txt);
    const out = (j.quoteResponse?.result || []).map(x => ({
      symbol: x.symbol,
      name: x.shortName || x.longName || x.displayName || x.symbol,
      price: x.regularMarketPrice,
      change: x.regularMarketChange,
      changePercent: x.regularMarketChangePercent,
      marketState: x.marketState,
      currency: x.currency,
      exchange: x.fullExchangeName,
      time: x.regularMarketTime ? new Date(x.regularMarketTime * 1000).toISOString() : null
    }));

    return { statusCode: 200, headers: baseHeaders, body: JSON.stringify(out) };
  } catch (e) {
    return {
      statusCode: 500,
      headers: baseHeaders,
      body: JSON.stringify({ error: true, message: e?.message || "stocks-sa failed" })
    };
  }
};
