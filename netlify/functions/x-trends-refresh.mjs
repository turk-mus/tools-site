// netlify/functions/x-trends-refresh.mjs
// يجلب الترندات بشكل مجدول ويخزنها في Netlify Blobs.
// لا تضع هنا schedule؛ خلّه في netlify.toml فقط.

import { getStore } from '@netlify/blobs';

// إعدادات عامة
const COUNTRY = (process.env.TRENDS_COUNTRY || 'SA').trim();
const WOEID   = (process.env.TRENDS_WOEID   || '23424938').trim(); // السعودية
const LANG    = (process.env.TRENDS_LANG    || 'ar').trim();

// حارس للتكرار + (اختياري) ميزانية شهرية
const MIN_INTERVAL_MIN   = parseInt(process.env.TRENDS_MIN_INTERVAL_MIN || '27', 10); // منع تشغيلين متقاربين
const MONTHLY_LIMIT      = parseInt(process.env.TRENDS_MONTHLY_LIMIT || '0', 10);     // 0 = معطّل

// فلترة كلمات غير لائقة
function isClean(text = '') {
  const bad = ['porn','sex','xxx','nsfw','fuck','shit','rape','قذف','اباح','جنس','سكس','شاذ','زب','كس','طيز','لعن'];
  const s = text.toLowerCase();
  return !bad.some(w => s.includes(w));
}

// تحويل أي شكل لمصفوفة (حتى لو كان trends = { "0": {...}, "1": {...} })
function toArray(x) {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') return Object.values(x);
  return [];
}

// تطبيع استجابة المزود لأبسط شكل نحتاجه
function normalize(raw) {
  const candidate = (raw && (raw.trends ?? raw.data ?? raw.result ?? raw.items)) ?? raw;
  const arr = toArray(candidate);

  return arr
    .map(t => {
      const name = t.name || t.title || t.hashtag || t.topic || t.query || '';
      const tag  = name?.startsWith('#') ? name : (name ? `#${name}` : '');

      // أحيانًا url = "search?q=..." → نحول لرابط كامل على X
      let link = t.url || t.permalink || '';
      if (!link) {
        link = name ? `https://x.com/search?q=${encodeURIComponent(name)}` : '#';
      } else if (!/^https?:\/\//i.test(link)) {
        link = `https://x.com/${link.replace(/^\/+/, '')}`;
      }

      const vol = t.tweet_volume ?? t.tweets ?? t.volume ?? t.count ?? null;
      return { name: tag, url: link, tweet_volume: vol };
    })
    .filter(t => t.name && t.name.startsWith('#'))
    .filter(t => isClean(t.name))
    .slice(0, 50);
}

// قوالب env مثل {country} {woeid} {lang}
function tpl(str = '', vars) {
  return str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
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

// استدعاء المزود (RapidAPI أو مباشر) حسب المتغيرات
async function fetchUpstream() {
  const vars = { country: COUNTRY.toLowerCase(), COUNTRY, woeid: WOEID, lang: LANG };

  // A) مزوّد مباشر عبر X_TRENDS_URL
  if (process.env.X_TRENDS_URL) {
    const method = (process.env.TRENDS_METHOD || 'GET').toUpperCase();
    let url  = process.env.X_TRENDS_URL;
    let init = { method, headers: buildHeaders() };

    const qs = process.env.TRENDS_QS || 'country={country}';
    if (method === 'GET') {
      url += (url.includes('?') ? '&' : '?') + tpl(qs, vars);
    } else {
      const bodyType = (process.env.TRENDS_BODY_TYPE || 'form').toLowerCase(); // form|json
      const bodyTpl  = process.env.TRENDS_BODY  || 'woeid={woeid}&country={country}&lang={lang}';
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
    if (!r.ok) throw new Error(`Direct provider error ${r.status}`);
    try { return await r.json(); } catch { return JSON.parse(await r.text()); }
  }

  // B) RapidAPI عبر TRENDS_HOST (+ PATH/METHOD/…)
  if (!process.env.TRENDS_HOST) throw new Error('Missing provider: set X_TRENDS_URL or RAPIDAPI_KEY + TRENDS_HOST');

  const path   = process.env.TRENDS_PATH || '/twitter/request.php';
  const method = (process.env.TRENDS_METHOD || (path.includes('request.php') ? 'POST' : 'GET')).toUpperCase();

  let url  = `https://${process.env.TRENDS_HOST}${path}`;
  let init = { method, headers: buildHeaders() };

  if (method === 'GET') {
    const qs = tpl(process.env.TRENDS_QS || 'country={country}', vars);
    url += (url.includes('?') ? '&' : '?') + qs;
  } else {
    const bodyType = (process.env.TRENDS_BODY_TYPE || 'form').toLowerCase(); // form|json
    const bodyTpl  = process.env.TRENDS_BODY  || 'woeid={woeid}&country={country}&lang={lang}';
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
  if (!r.ok) throw new Error(`RapidAPI error ${r.status} ${text.slice(0,200)}`);
  try { return JSON.parse(text); } catch { return {}; }
}

export default async () => {
  const store    = getStore('trends');
  const dataKey  = `${COUNTRY}.json`;
  const budgetKey = `_budget.json`;

  // حارس - أقل فاصل زمني
  let lastUpdated = 0;
  const existing = await store.get(dataKey);
  if (existing) {
    try { lastUpdated = Date.parse(JSON.parse(existing).updated_at) || 0; } catch {}
  }
  if (Date.now() - lastUpdated < MIN_INTERVAL_MIN * 60 * 1000) {
    return new Response(null, { status: 204 });
  }

  // ميزانية شهرية (اختياري)
  if (MONTHLY_LIMIT > 0) {
    const nowMonth = new Date().toISOString().slice(0,7); // YYYY-MM
    let budget = { month: nowMonth, count: 0 };
    const budgetRaw = await store.get(budgetKey);
    if (budgetRaw) {
      try {
        const parsed = JSON.parse(budgetRaw);
        budget = (parsed.month === nowMonth) ? parsed : { month: nowMonth, count: 0 };
      } catch {}
    }
    if (budget.count >= MONTHLY_LIMIT) {
      return new Response(null, { status: 204 }); // تخطّي السقف: لا نحدّث (نستمر بالكاش القديم)
    }

    // جلب وكتابة ثم تحديث العداد
    const raw = await fetchUpstream();
    const trends = normalize(raw);
    const payload = { country: COUNTRY, updated_at: new Date().toISOString(), trends };

    await store.setJSON(dataKey, payload, { metadata: { updated_at: payload.updated_at } });
    await store.setJSON(budgetKey, { month: nowMonth, count: budget.count + 1 }, {});
    return new Response(null, { status: 204 });
  }

  // بدون ميزانية شهرية
  const raw = await fetchUpstream();
  const trends = normalize(raw);
  const payload = { country: COUNTRY, updated_at: new Date().toISOString(), trends };
  await store.setJSON(dataKey, payload, { metadata: { updated_at: payload.updated_at } });

  return new Response(null, { status: 204 });
};
