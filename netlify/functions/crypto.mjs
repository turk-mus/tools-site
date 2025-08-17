// netlify/functions/crypto.mjs
export const handler = async (event) => {
  const baseHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    // كاش على طبقة CDN (Netlify Edge)
    "Netlify-CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: baseHeaders, body: "" };
  }

  try {
    const qs = event.queryStringParameters || {};
    const ids = (qs.ids || "bitcoin,ethereum,tether,solana,binance-coin,xrp")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .join(",");

    if (!ids) {
      return { statusCode: 400, headers: baseHeaders, body: '{"error":"ids required"}' };
    }

    const url = "https://api.coingecko.com/api/v3/coins/markets"
      + "?vs_currency=usd"
      + "&ids=" + encodeURIComponent(ids)
      + "&price_change_percentage=24h";

    const r = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "as3aralywm/1.0 (+https://as3aralywm.com)"
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

    const arr = JSON.parse(txt);
    const out = (Array.isArray(arr) ? arr : []).map(x => ({
      id: x.id,
      symbol: x.symbol,
      name: x.name,
      priceUSD: x.current_price,
      change24h: x.price_change_percentage_24h,
      marketCap: x.market_cap,
      image: x.image,
      lastUpdated: x.last_updated
    }));

    return { statusCode: 200, headers: baseHeaders, body: JSON.stringify(out) };
  } catch (e) {
    return {
      statusCode: 500,
      headers: baseHeaders,
      body: JSON.stringify({ error: true, message: e?.message || "crypto failed" })
    };
  }
};
