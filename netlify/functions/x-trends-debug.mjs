const WOEID = process.env.TRENDS_WOEID || '23424938';
const COUNTRY = (process.env.TRENDS_COUNTRY || 'SA').trim();

function hdrs() {
  const h = { Accept: 'application/json' };
  if (process.env.RAPIDAPI_KEY && process.env.TRENDS_HOST) {
    h['X-RapidAPI-Key']  = process.env.RAPIDAPI_KEY;
    h['X-RapidAPI-Host'] = process.env.TRENDS_HOST;
  }
  if (process.env.X_TRENDS_API_KEY) h.Authorization = `Bearer ${process.env.X_TRENDS_API_KEY}`;
  return h;
}

export default async () => {
  try {
    const host = process.env.TRENDS_HOST;
    const path = process.env.TRENDS_PATH || '/twitter/request.php';
    let method = (process.env.TRENDS_METHOD || (path.includes('request.php') ? 'POST' : 'GET')).toUpperCase();
    let url = host ? `https://${host}${path}` : process.env.X_TRENDS_URL;
    let body, note = host ? 'rapidapi' : 'direct';

    if (!url) return new Response(JSON.stringify({ error:'No provider configured' }), { status: 500 });

    if (method === 'GET') {
      const qs = process.env.TRENDS_QS || `country=${COUNTRY}`;
      url += (url.includes('?') ? '&' : '?') + qs;
    } else {
      const bodyType = (process.env.TRENDS_BODY_TYPE || 'form').toLowerCase(); // form|json
      const bodyTpl  = process.env.TRENDS_BODY || `woeid=${WOEID}&country=${COUNTRY}&lang=ar`;
      if (bodyType === 'json') {
        body = JSON.stringify(Object.fromEntries(new URLSearchParams(bodyTpl)));
        hdrs()['Content-Type'] = 'application/json';
      } else {
        body = new URLSearchParams(bodyTpl);
        hdrs()['Content-Type'] = 'application/x-www-form-urlencoded';
      }
      note += `:${bodyType}`;
    }

    const res = await fetch(url, { method, headers: hdrs(), body });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch {}
    const sample = Array.isArray(parsed) ? parsed.slice(0,2)
                 : (parsed?.trends || parsed?.data || parsed?.result || []).slice?.(0,2) || null;

    return new Response(JSON.stringify({ note, method, url, status: res.status, ok: res.ok, sample, raw: text.slice(0,400) }, null, 2), {
      status: 200, headers: { 'Content-Type':'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }, null, 2),
      { status: 500, headers: { 'Content-Type':'application/json' }});
  }
};
