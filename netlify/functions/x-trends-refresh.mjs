// netlify/functions/x-trends-refresh.mjs
import { getStore } from '@netlify/blobs';

export const handler = async () => {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };

  try {
    // ✅ URL آمن: production ثم deploy ثم الدومين عندك
    const BASE = process.env.URL || process.env.DEPLOY_URL || 'https://as3aralywm.com';
    const limit = 10;

    // اطلب دالتك الحالية التي ترجع مصفوفة ترندات
    const upstreamURL = `${BASE}/.netlify/functions/x-trends?limit=${limit}`;
    const upstream = await fetch(upstreamURL, { headers: { 'Accept': 'application/json' } });

    if (!upstream.ok) {
      const text = await upstream.text();
      return { statusCode: 502, headers, body: JSON.stringify({ ok:false, where:'upstream', status:upstream.status, text }) };
    }

    const arr = await upstream.json();
    if (!Array.isArray(arr)) {
      return { statusCode: 500, headers, body: JSON.stringify({ ok:false, where:'shape', msg:'upstream did not return array' }) };
    }

    // خزّن في Blobs
    const store = getStore('trends');
    await store.set('latest.json', JSON.stringify(arr), { contentType: 'application/json' });

    return { statusCode: 200, headers, body: JSON.stringify({ ok:true, count: arr.length, source: 'refresh' }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok:false, where:'handler', error: String(e) }) };
  }
};
