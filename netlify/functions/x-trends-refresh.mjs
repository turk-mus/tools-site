// يجلب الترندات ويكتبها في Netlify Blobs مع "ميزانية شهرية" + حد أدنى للفاصل الزمني
import { getStore } from '@netlify/blobs';

const COUNTRY = (process.env.TRENDS_COUNTRY || 'SA').trim();
const WOEID   = (process.env.TRENDS_WOEID   || '23424938').trim(); // السعودية
const LANG    = (process.env.TRENDS_LANG    || 'ar').trim();

// ميزانية شهرية + أقل فاصل بين تحديثين
const MONTHLY_LIMIT   = parseInt(process.env.TRENDS_MONTHLY_LIMIT || '100', 10);
const MIN_INTERVAL_HR = parseInt(process.env.TRENDS_MIN_INTERVAL_HOURS || '8', 10);

function isClean(text='') {
  const bad = ['porn','sex','xxx','nsfw','fuck','shit','rape','قذف','اباح','جنس','سكس','شاذ','زب','كس','طيز','لعن'];
  const s = text.toLowerCase();
  return !bad.some(w => s.includes(w));
}

function tpl(str='', vars){ return str.replace(/\{(\w+)\}/g,(_,k)=> (vars[k] ?? '')); }

function buildHeaders(){
  const h = { Accept:'application/json' };
  if (process.env.X_TRENDS_API_KEY) h.Authorization = `Bearer ${process.env.X_TRENDS_API_KEY}`;
  if (process.env.RAPIDAPI_KEY && process.env.TRENDS_HOST){
    h['X-RapidAPI-Key']  = process.env.RAPIDAPI_KEY;
    h['X-RapidAPI-Host'] = process.env.TRENDS_HOST;
  }
  return h;
}

// مزوّد عام (مباشر أو RapidAPI)
async function fetchUpstream(){
  const vars = { country: COUNTRY.toLowerCase(), COUNTRY, woeid: WOEID, lang: LANG };

  // مزوّد مباشر عبر X_TRENDS_URL
  if (process.env.X_TRENDS_URL){
    const method = (process.env.TRENDS_METHOD || 'GET').toUpperCase();
    let url  = process.env.X_TRENDS_URL;
    let init = { method, headers: buildHeaders() };

    const qs = process.env.TRENDS_QS || 'country={country}';
    if (method === 'GET'){
      url += (url.includes('?') ? '&' : '?') + tpl(qs, vars);
    } else {
      const bodyType = (process.env.TRENDS_BODY_TYPE || 'form').toLowerCase(); // form|json
      const bodyTpl  = process.env.TRENDS_BODY || 'woeid={woeid}&country={country}&lang={lang}';
      const bodyStr  = tpl(bodyTpl, vars);
      if (bodyType === 'json'){
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(Object.fromEntries(new URLSearchParams(bodyStr)));
      } else {
        init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        init.body = new URLSearchParams(bodyStr);
      }
    }
    const r = await fetch(url, init);
    if (!r.ok) throw new Error(`Direct provider error ${r.status}`);
    return r.json();
  }

  // RapidAPI
  if (!process.env.TRENDS_HOST) throw new Error('Missing provider: set X_TRENDS_URL or RAPIDAPI_KEY + TRENDS_HOST');

  const path   = process.env.TRENDS_PATH || '/twitter/request.php';
  const method = (process.env.TRENDS_METHOD || (path.includes('request.php') ? 'POST' : 'GET')).toUpperCase();

  let url  = `https://${process.env.TRENDS_HOST}${path}`;
  let init = { method, headers: buildHeaders() };

  if (method === 'GET'){
    const qs = tpl(process.env.TRENDS_QS || 'country={country}', vars);
    url += (url.includes('?') ? '&' : '?') + qs;
  } else {
    const bodyType = (process.env.TRENDS_BODY_TYPE || 'form').toLowerCase(); // form|json
    const bodyTpl  = process.env.TRENDS_BODY || 'woeid={woeid}&country={country}&lang={lang}';
    const bodyStr  = tpl(bodyTpl, vars);
    if (bodyType === 'json'){
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(Object.fromEntries(new URLSearchParams(bodyStr)));
    } else {
      init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      init.body = new URLSearchParams(bodyStr);
    }
  }

  const r = await fetch(url, init);
  const text = await r.text();
  if (!r.ok) throw new Error(`RapidAPI error ${r.status} ${text.slice(0,200)}`);
  try { return JSON.parse(text); } catch { return {}; }
}

function normalize(raw){
  const arr = Array.isArray(raw) ? raw : (raw.trends || raw.data || raw.result || raw.items || []);
  return (arr || [])
    .map(t => {
      const name = t.name || t.title || t.hashtag || t.topic || t.query || '';
      const tag  = name?.startsWith('#') ? name : (name ? `#${name}` : '');
      const url  = t.url || t.permalink || (name ? `https://x.com/search?q=${encodeURIComponent(name)}` : '#');
      const vol  = t.tweet_volume ?? t.tweets ?? t.volume ?? t.count ?? null;
      return { name: tag, url, tweet_volume: vol };
    })
    .filter(t => t.name && t.name.startsWith('#'))
    .filter(t => isClean(t.name))
    .slice(0, 50);
}

export default async () => {
  const store = getStore('trends');
  const dataKey   = `${COUNTRY}.json`;
  const budgetKey = `_budget.json`;

  // اقرأ آخر تحديث
  const existing = await store.get(dataKey);
  let lastUpdated = 0;
  if (existing){
    try { lastUpdated = Date.parse(JSON.parse(existing).updated_at) || 0; } catch {}
  }

  // احترم أقل فاصل زمني
  if (Date.now() - lastUpdated < MIN_INTERVAL_HR * 60 * 60 * 1000){
    return new Response(null, { status: 204 });
  }

  // احسب ميزانية الشهر
  const nowMonth = new Date().toISOString().slice(0,7); // YYYY-MM
  let budget = { month: nowMonth, count: 0 };
  const budgetRaw = await store.get(budgetKey);
  if (budgetRaw){
    try {
      const parsed = JSON.parse(budgetRaw);
      budget = (parsed.month === nowMonth) ? parsed : { month: nowMonth, count: 0 };
    } catch {}
  }

  if (budget.count >= MONTHLY_LIMIT){
    // تعدّي الميزانية → لا نحدّث (نستمر بعرض الكاش القديم)
    return new Response(null, { status: 204 });
  }

  // جلب من المزود
  const raw = await fetchUpstream();
  const trends = normalize(raw);

  // اكتب البيانات
  const payload = { country: COUNTRY, updated_at: new Date().toISOString(), trends };
  await store.setJSON(dataKey, payload, { metadata: { updated_at: payload.updated_at } });

  // حدّث العداد
  await store.setJSON(budgetKey, { month: nowMonth, count: budget.count + 1 }, {});

  return new Response(null, { status: 204 });
};
