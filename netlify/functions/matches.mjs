// netlify/functions/matches.mjs
export async function handler(event) {
  const qp = event.queryStringParameters || {};
  const q = (qp.q ?? "").toLowerCase().trim();     // قد يكون فاضي (عالمي)
  const limit = Math.max(1, Math.min(30, parseInt(qp.limit || "12")));
  const doFallback = String(qp.fallback || "1") !== "0"; // افتراضيًا نفعل fallback

  // مرادفات شائعة
  const syn = {
    "saudi": ["saudi", "saudi arabia", "pro league", "roshn", "ksa"],
    "premier": ["premier", "england", "english"],
    "la liga": ["la liga", "laliga", "spain"],
    "serie a": ["serie a", "italy", "italia"],
    "bundesliga": ["bundesliga", "germany"],
    "ligue 1": ["ligue 1", "france"],
    "champions": ["champions", "uefa champions league", "ucl"]
  };
  const keys = q ? (syn[q] || [q]) : [];

  try {
    const upstream = await fetch("https://www.scorebat.com/video-api/v3/");
    if (!upstream.ok) {
      return send(502, { ok: false, reason: "Upstream error", status: upstream.status });
    }
    const data = await upstream.json();
    const src = Array.isArray(data.response) ? data.response : [];

    const raw = src.map(it => {
      const title = it?.title || "";
      const comp  = it?.competition?.name || "";
      const home  = it?.side1?.name || "";
      const away  = it?.side2?.name || "";
      const date  = it?.date || null;

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
    });

    // فلترة حسب المرادفات (إن وُجدت قيمة q)
    let filtered = raw;
    if (keys.length) {
      filtered = raw.filter(x => {
        const hay = `${x.comp} ${x.home} ${x.away} ${x.title}`.toLowerCase();
        return keys.some(k => hay.includes(k));
      });
    }

    // fallback: لو ما لقينا شيء، رجّع أحدث الملخصات عالميًا
    if (filtered.length === 0 && doFallback) {
      filtered = raw;
    }

    // ترتيب حسب التاريخ تنازلي + قص
    filtered = filtered
      .sort((a, b) => (new Date(b.startUTC || 0)) - (new Date(a.startUTC || 0)))
      .slice(0, limit);

    return send(200, filtered);
  } catch (e) {
    return send(500, { ok: false, reason: e.message || "error" });
  }
}

function send(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "Netlify-CDN-Cache-Control": "public, s-maxage=900, stale-while-revalidate=60",
      "Cache-Control": "public, max-age=0",
    },
    body: JSON.stringify(body)
  };
}
