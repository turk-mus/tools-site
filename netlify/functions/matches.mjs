// netlify/functions/matches.mjs
export async function handler(event) {
  const qp = event.queryStringParameters || {};
  const q = (qp.q || "saudi").toLowerCase();       // فلترة: "saudi" افتراضيًا (الدوري السعودي). جرّب: "premier", "la liga", الخ.
  const limit = Math.max(1, Math.min(30, parseInt(qp.limit || "12")));

  try {
    const r = await fetch("https://www.scorebat.com/video-api/v3/");
    if (!r.ok) {
      return resp(502, { ok: false, reason: "Upstream error", status: r.status });
    }
    const j = await r.json();
    const arr = (j.response || []).map(it => {
      const home = it?.side1?.name || "";
      const away = it?.side2?.name || "";
      const comp = it?.competition?.name || "";
      const title = it?.title || "";
      const date = it?.date || null;
      // حاول استخراج النتيجة من العنوان (إن وُجدت)
      let score = null;
      const m1 = title.match(/(\d+)\s*[-:]\s*(\d+)\s*$/) || title.match(/\b(\d+)\s*-\s*(\d+)\b/);
      if (m1) score = `${m1[1]}-${m1[2]}`;
      return {
        home, away, score,
        comp,
        startUTC: date,
        highlightUrl: it?.url || it?.matchviewUrl || null,
        thumb: it?.thumbnail || null,
        title
      };
    }).filter(x => {
      // فلترة حسب النص
      const hay = `${x.comp} ${x.home} ${x.away} ${x.title}`.toLowerCase();
      return hay.includes(q);
    }).sort((a, b) => (new Date(b.startUTC || 0)) - (new Date(a.startUTC || 0)))
      .slice(0, limit);

    return resp(200, arr);
  } catch (e) {
    return resp(500, { ok: false, reason: e.message || "error" });
  }
}

function resp(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // كاش على CDN 15 دقيقة + SWR دقيقة
      "Netlify-CDN-Cache-Control": "public, s-maxage=900, stale-while-revalidate=60",
      "Cache-Control": "public, max-age=0",
    },
    body: JSON.stringify(body)
  };
}
