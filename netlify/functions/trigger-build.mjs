// netlify/functions/trigger-build.mjs
export const handler = async () => {
  try {
    const url = process.env.BUILD_HOOK_URL; // أضفه في متغيرات البيئة
    if (!url) return { statusCode: 500, body: 'Missing BUILD_HOOK_URL' };

    const r = await fetch(url, { method: 'POST' });
    if (!r.ok) return { statusCode: r.status, body: 'Hook error' };

    // إذا نجح، Netlify راح يبدأ Deploy -> وقت الـ Deploy يشتغل node scripts/fetch-gold.mjs
    return { statusCode: 200, body: 'Triggered build' };
  } catch (e) {
    return { statusCode: 500, body: 'trigger-build error: ' + (e?.message || String(e)) };
  }
};
