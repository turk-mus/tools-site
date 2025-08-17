// netlify/functions/stocks-sa.mjs
export const handler = async (event) => {
  const baseHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    // قلّل ضغط الطلبات على ياهو + اسمح بالقديم أثناء التحديث
    "Netlify-CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
    "Content-Type": "application/json; charset=utf-8",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: baseHeaders, body: "" };
  }

  try {
    const qs = new URLSearchParams(event.queryStringParameters || {});
    const raw = (qs.get("symbols") || "").trim();
    if (!raw) {
      return { statusCode: 400, headers: baseHeaders, body: JSON.stringify({ error: "symbols required" }) };
    }

    // رمّز كل رمز لوحده (خصوصًا ^TASI)
    const symbols = raw.split(",").map(s => s.trim()).filter(Boolean);
    const joined = symbols.map(s => encodeURIComponent(s)).join(",");

    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari";
    const headers = { "User-Agent": UA, "Accept": "application/json", "Accept-Language": "ar-SA,ar;q=0.9,en;q=0.8" };

    // مهلة قصيرة + إعادة محاولة على نطاق بديل ليـاهو
    const fetchWithTimeout = (url, ms = 5000) => new Promise((resolve, reject) => {
      const ac = new AbortController();
      const id = setTimeout(() => ac.abort(), ms);
      fetch(url, { headers, signal: ac.signal }).then(r => {
        clearTimeout(id); resolve(r);
      }).catch(err => { clearTimeout(id); reject(err); });
    });

    const tryOnce = async (host) => {
      const url = `https://${host}/v7/finance/quote?symbols=${joined}`;
      const r = await fetchWithTimeout(url, 6000);
      if (!r.ok) throw new Error(`${host} ${r.status}`);
      const j = await r.json();
      return j?.quoteResponse?.result || [];
    };

    let results = [];
    try {
      results = await tryOnce("query1.finance.yahoo.com");
    } catch {
      // محاولة ثانية سريعة
      results = await tryOnce("query2.finance.yahoo.com");
    }

    // لو مافيه ولا نتيجة، نرجّع رسالة مفيدة بدل 504
    if (!Array.isArray(results) || results.length === 0) {
      return { statusCode: 200, headers: baseHeaders, body: JSON.stringify({ ok:false, reason:"no-data" }) };
    }

    // خرّج فقط الحقول المهمة للواجهة
    const out = results.map(r => ({
      symbol: r.symbol,
      name: r.longName || r.shortName || r.symbol,
      price: r.regularMarketPrice ?? null,
      change: r.regularMarketChange ?? null,
      changePercent: r.regularMarketChangePercent ?? null,
      currency: r.currency || "SAR",
      marketState: r.marketState || null,
      time: r.regularMarketTime ? new Date(r.regularMarketTime * 1000).toISOString() : null
    }));

    return { statusCode: 200, headers: baseHeaders, body: JSON.stringify({ ok:true, data: out }) };
  } catch (e) {
    // لا نرجّع 504 للواجهة؛ نخليها 200 برسالة، والواجهة تعرض "تعذّر الجلب"
    return {
      statusCode: 200,
      headers: { "Content-Type":"application/json; charset=utf-8", "Access-Control-Allow-Origin":"*" },
      body: JSON.stringify({ ok:false, error: e?.message || "stocks failed" })
    };
  }
};
