// netlify/functions/x-trends-refresh-now.mjs
// يشغَّل يدويًا من المتصفح لتعبئة كاش الترندات فورًا في Netlify Blobs.

import { getStore } from '@netlify/blobs';

// ===== Helpers =====
const DEF_COUNTRY = (process.env.TRENDS_COUNTRY || 'SA').trim();
const DEF_WOEID   = (process.env.TRENDS_WOEID   || '23424938').trim(); // السعودية
const DEF_LANG    = (process.env.TRENDS_LANG    || 'ar').trim();

function tpl(str = '', vars) { return str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '')); }
function toArray(x){ return Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.values(x) : []); }

function isClean(txt=''){
  const bad = ['porn','sex','xxx','nsfw','fuck','shit','rape','قذف','اباح','جنس','سكس','شاذ','زب','كس','طيز','لعن'];
  const s = String(txt).toLowerCase();
  return !bad.some(w => s.includes(w));
}

function buildHeaders() {
  const h = { Accept: 'application/json' };
  if (process.env.X_TRENDS_API_KEY) h.Authorization = `Bearer ${process.env.X_TRENDS_API_KEY}`;
  if (process.env.RAPIDAPI_KEY && process.env.TRENDS_HOST) {
    h['X-RapidAPI-Key']  = process.env.RAPIDAPI_KEY;
    h['X-RapidAPI-Host'] = process.env.TRENDS_HOST;
  }
  return h;
}

function normalize(raw, limit=50){
  const candidate = (raw && (raw.trends ?? raw.data ?? raw.result ?? raw.items)) ?? raw;
  const arr = toArray(candidate);

  return arr
    .map(t => {
      const name = t?.name ?? t?.title ?? t?.hashtag ?? t?.topic ?? t?.query ?? '';
      const tag  = name?.startsWith('#') ? name : (name ? `#${name}` : '');

      // بعض المزودين يعيدون "search?q=..." فقط
      let link = t?.url ?? t?.permalink ?? '';
      if (!link) {
        link = name ? `https://x.com/search?q=${encodeURIComponent(name)}` : '#';
      } else if (!/^https?:\/\//i.test(link)) {
        link = `https://x.com/${link.replace(/^\/+/, '')}`;
      }

      const vol = t?.tweet_volume ?? t?.tweets ?? t?.volume ?? t?.count ?? null;
      return { name: tag, url: link, tweet_volume: vol };
    })
    .filter(t => t.name && t.name.startsWith('#') && isClean(t.name))
    .slice(0, limit);
}

async function fetchUpstream({ country, woeid, lang }) {
  const headers = buildHeaders();
  const vars = { country: country.toLowerCase(), COUNTRY: country, woeid, lang };

  // A) direct provider via X_TRENDS_URL (optional)
  if (process.env.X_TRENDS_URL) {
    const method = (process.env.TRENDS_METHOD || 'GET').toUpperCase();
    let url = process.env.X_TRENDS_URL;
    const init = { method, headers };

    if (method === 'GET') {
      const qs = process.env.TRENDS_QS || 'country={country}';
      url += (url.includes('?') ? '&' : '?') + tpl(qs, vars);
    } else {
      const bodyType = (process.env.TRENDS_BODY_TYPE || 'form').toLowerCase(); // form|json
      const bodyTpl  = process.env.TRENDS_BODY || 'woeid={woeid}&country={country}&lang={lang}';
      const bodyStr  = tpl(bodyTpl, vars);
      if (bodyType === 'json') {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(Object.fromEntries(new URLSearchParams(bodyStr)));
      } else {
        init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        init.body = new URLSearchParams(bodyStr);
      }
    }

    const r = await fetch(url, init);
    const text = await r.text();
    if (!r.ok) throw new Error(`direct ${r.status}: ${text.slice(0,200)}`);
    try { return JSON.parse(text); } catch { return {}; }
  }

  // B) RapidAPI via TRENDS_HOST (+ PATH/METHOD/…)
  const host = process.env.TRENDS_HOST;
  if (!host) throw new Error('No provider configured: set X_TRENDS_URL or RAPIDAPI_KEY + TRENDS_HOST.');

  const path   = process.env.TRENDS_PATH || '/twitter/request.php';
  const method = (process.env.TRENDS_METHOD || (path.includes('request.php') ? 'POST' : 'GET')).toUpperCase();

  let url  = `https://${host}${path}`;
  const init = { method, headers };

  if (method === 'GET') {
    const qs = tpl(process.env.TRENDS_QS || 'country={country}', vars);
    url += (url.includes('?') ? '&' : '?') + qs;
  } else {
    const bodyType = (process.env.TRENDS_BODY_TYPE || 'form').toLowerCase(); // form|json
    const bodyTpl  = process.env.TRENDS_BODY || 'woeid={woeid}&country={country}&lang={lang}';
    const bodyStr  = tpl(bodyTpl, vars);
    if (bodyType === 'json') {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(Object.fromEntries(new URLSearchParams(bodyStr)));
    } else {
      init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      init.body = new URLSearchParams(bodyStr);
    }
  }

  const r = await fetch(url, init);
  const text = await r.text();
  if (!r.ok) throw new Error(`rapidapi ${r.status}: ${text.slice(0,200)}`);
  try { return JSON.parse(text); } catch { return {}; }
}

// ===== Function =====
export default async (req) => {
  try {
    const url = new URL(req.url);
    const country = (url.searchParams.get('country') || DEF_COUNTRY).trim();
    const woeid   = (url.searchParams.get('woeid')   || DEF_WOEID).trim();
    const lang    = (url.searchParams.get('lang')    || DEF_LANG).trim();
    const limit   = Math.max(1, Math.min(50, parseInt(url.searchParams.get('limit') || '50', 10)));

    const raw    = await fetchUpstream({ country, woeid, lang });
    const trends = normalize(raw, limit);

    const payload = { country, updated_at: new Date().toISOString(), trends };
    const store = getStore('trends');
    await store.setJSON(`${country}.json`, payload, { metadata: { updated_at: payload.updated_at } });

    return new Response(JSON.stringify({
      ok: true,
      country,
      wrote: trends.length,
      updated_at: payload.updated_at,
      sample: trends.slice(0, 3)
    }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' }});

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }, null, 2), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
