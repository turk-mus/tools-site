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
    // الرموز من الاستعلام أو افتراضي:
    const q = event.queryStringParameters || {};
    const def = ["2222.SR","2010.SR","7010.SR","1120.SR","1180.SR","2280.SR","^TASI"];
    const raw = (q.symbols && q.symbols.trim()) ? q.symbols.split(",") : def;

    // تأكد من امتداد .SR للرموز الرقمية لو نُسِيَت:
    const symbols = raw.map(s => {
      const t = s.trim();
      if (!t) return null;
      if (t.startsWith("^")) return t;          // مؤشرات مثل ^TASI
      if (/\.\w+$/i.test(t)) return t;          // فيه امتداد أصلاً
      if (/^\d{3,4}$/.test(t)) return `${t}.SR`; // رقم بدون امتداد
      return t;
    }).filter(Boolean);

    if (!symbols.length) {
      return {
        statusCode: 400,
        headers: baseHeaders,
        body: JSON.stringify({ error: "no symbols" })
      };
    }

    // Yahoo يحتاج الترميز لكل رمز (خصوصًا ^TASI)
    const encoded = symbols.map(encodeURIComponent).join("%2C");
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encoded}`;

    const r = await fetch(url, {
      headers: {
        "Accept": "application/json",
        // UA لتفادي بعض الحمايات
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
      }
    });

    const txt = await r.text();
    if (!r.ok) {
      return {
        statusCode: 502,
        headers: baseHeaders,
        body: JSON.stringify({ upstreamStatus: r.status, upstreamOk: false, data: txt.slice(0,400) })
      };
    }

    const j = JSON.parse(txt);
    const rows = (j?.quoteResponse?.result || []).map(v => ({
      symbol: v.symbol,
      name: v.shortName || v.longName || v.displayName || v.symbol,
      exchange: v.fullExchangeName || v.exchange,
      price: v.regularMarketPrice ?? null,
      change: v.regularMarketChange ?? null,
      changePercent: v.regularMarketChangePercent ?? null,
      currency: v.currency || null,
      marketState: v.marketState || null,
      time: v.regularMarketTime ? (v.regularMarketTime * 1000) : null
    }));

    return {
      statusCode: 200,
      headers: {
        ...baseHeaders,
        "Content-Type": "application/json; charset=utf-8",
        // كاش على حافة نتلايفي
        "Netlify-CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
        "Cache-Control": "public, max-age=0, must-revalidate"
      },
      body: JSON.stringify({ ok: true, count: rows.length, results: rows })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: baseHeaders,
      body: JSON.stringify({ ok:false, error: e?.message || "stocks-sa failed" })
    };
  }
};
