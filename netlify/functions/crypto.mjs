// netlify/functions/crypto.mjs
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
    // ids من CoinCap (بدون مفتاح)
    // تقدر تغيّرها عبر ?ids=bitcoin,ethereum,solana ...
    const qs = new URLSearchParams(event.queryStringParameters || {});
    const ids = (qs.get("ids") || "bitcoin,ethereum,tether,binance-coin,xrp,solana,dogecoin,tron,cardano,toncoin")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .join(",");

    const url = `https://api.coincap.io/v2/assets?ids=${encodeURIComponent(ids)}`;
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) {
      return {
        statusCode: r.status,
        headers: { ...baseHeaders, "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ error: true, upstreamStatus: r.status })
      };
    }
    const j = await r.json();
    const SAR = 3.75; // الريال مربوط بالدولار
    const data = (j.data || []).map(a => {
      const priceUsd = Number(a.priceUsd || 0);
      const change = Number(a.changePercent24Hr || 0);
      return {
        id: a.id,
        symbol: a.symbol,
        name: a.name,
        rank: Number(a.rank || 0),
        price_usd: +priceUsd.toFixed(6),
        price_sar: +(priceUsd * SAR).toFixed(4),
        change_24h: +change.toFixed(2)
      };
    });

    return {
      statusCode: 200,
      headers: {
        ...baseHeaders,
        "Content-Type": "application/json; charset=utf-8",
        // كاش على حافة نتلايفي لخفض الاستهلاك (5 دقائق)
        "Netlify-CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
        "Cache-Control": "public, max-age=60"
      },
      body: JSON.stringify({ ok: true, count: data.length, data })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: baseHeaders,
      body: JSON.stringify({ error: true, message: e?.message || "crypto failed" })
    };
  }
};
