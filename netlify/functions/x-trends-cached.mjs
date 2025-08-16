// netlify/functions/x-trends-cached.mjs
export const handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
    // ✅ كاش نتلايفي CDN ساعة + سماح دقيقة للتحديث بالخلفية
    "Netlify-CDN-Cache-Control": "public, s-maxage=3600, stale-while-revalidate=60",
  };
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  try {
    // نستخدم دالتك الحالية x-trends كمصدر وحيد
    const BASE = process.env.URL || process.env.DEPLOY_URL || "https://as3aralywm.com";
    const limit = 10; // ثبّتناه لتوحيد مفتاح الكاش
    const upstreamURL = `${BASE}/.netlify/functions/x-trends?limit=${limit}`;

    const r = await fetch(upstreamURL, { headers: { "Accept": "application/json" } });
    if (!r.ok) {
      const text = await r.text();
      return { statusCode: 502, headers, body: JSON.stringify({ ok:false, where:"upstream", status:r.status, text }) };
    }

    // نمرّر النص كما هو (مصفوفة)
    const text = await r.text();
    return { statusCode: 200, headers, body: text };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok:false, where:"handler", error:String(e) }) };
  }
};
