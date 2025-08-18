// يجلب الترندات كل 30 دقيقة ويخزنها في Netlify Blobs
// يدعم: X_TRENDS_URL (+Bearer GET) أو RapidAPI twitter-trends5 (POST /twitter/request.php)
import { getStore } from '@netlify/blobs';

function isClean(text = '') {
  const bad = ['porn','sex','xxx','nsfw','fuck','shit','rape',
    'قذف','اباح','جنس','سكس','شاذ','زب','كس','طيز','لعن'];
  const s = (text||'').toLowerCase();
  return !bad.some(w => s.includes(w));
}

const DEFAULT_WOEID = process.env.TRENDS_WOEID || '23424938'; // KSA
const DEFAULT_COUNTRY = (process.env.TRENDS_COUNTRY || 'SA').trim();
const DEFAULT_LANG = process.env.TRENDS_LANG || 'ar';

function buildHeaders() {
  const h = { Accept: 'application/json' };
  if (process.env.X_TRENDS_API_KEY) h.Authorization = `Bearer ${process.env.X_TRENDS_API_KEY}`;
  if (process.env.RAPIDAPI_KEY && process.env.TRENDS_HOST) {
    h['X-RapidAPI-Key'] = process.env.RAPIDAPI_KEY;
    h['X-RapidAPI-Host'] = process.env.TRENDS_HOST;
  }
  return h;
}

async function fetchFromDirect(country) {
  if (!process.env.X_TRENDS_URL) return null;
  const url = `${process.env.X_TRENDS_URL}${encodeURIComponent(country)}`;
  const res = await fetch(url, { headers: buildHeaders() });
  if (!res.ok) throw new Error('Upstream error '+res.status);
  return res.json();
}

async function fetchFromRapidAPI(country) {
  if (!process.env.TRENDS_HOST || !process.env.RAPIDAPI_KEY) return null;

  // السماح بتعديل المسار من المتغيرات، وإلا استخدم مسار twitter-trends5 الافتراضي
  const path = process.env.TRENDS_PATH || '/twitter/request.php';
  const url = `https://${process.env.TRENDS_HOST}${path}`;

  const isTwitterReq = path.includes('/twitter/request.php');
  const method = isTwitterReq ? 'POST' : 'GET';

  const headers = buildHeaders();
  let body, finalUrl = url;

  if (method === 'POST') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const form = new URLSearchParams({
      woeid: DEFAULT_WOEID,
      country: country.toLowerCase(),
      lang: DEFAULT_LANG
    });
    body = form;
  } else {
    const qs = new URLSearchParams({ country });
    finalUrl = url + (url.includes('?') ? '&' : '?') + qs.toString();
  }

  const res = await fetch(finalUrl, { method, headers, body });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error('RapidAPI error '+res.status+' '+txt);
  }

  const text = await res.text();
  try { return JSON.parse(text); } catch { return {}; }
}

export default async () => {
  const country = DEFAULT_COUNTRY;
  const store = getStore('trends');
  const key = `${country}.json`;

  // حماية من التكرار: تجاهل التنفيذ لو آخر تحديث كان قبل <27 دقيقة
  const existing = await store.get(key);
  if (existing) {
    try {
      const { updated_at } = JSON.parse(existing);
      if (updated_at && (Date.now() - new Date(updated_at).getTime()) < 27*60*1000) {
        return new Response(null, { status: 204 });
      }
    } catch {}
  }

  // 1) مزوّد مباشر إن وُجد
  let raw = null;
  if (process.env.X_TRENDS_URL) {
    raw = await fetchFromDirect(country);
  } else {
    // 2) RapidAPI twitter-trends5
    raw = await fetchFromRapidAPI(country);
  }
  if (!raw) return new Response(null, { status: 204 });

  // تطبيع
  const arr = Array.isArray(raw) ? raw : (raw.trends || raw.data || raw.result || []);
  const trends = (arr || [])
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

  const payload = { country, updated_at: new Date().toISOString(), trends };
  await store.setJSON(key, payload, { metadata: { updated_at: payload.updated_at } });

  return new Response(null, { status: 204 });
};
