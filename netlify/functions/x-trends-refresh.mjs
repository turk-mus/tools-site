// netlify/functions/x-trends-refresh.mjs
import { getStore } from '@netlify/blobs';

export const handler = async () => {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  try {
    // 👈 نعيد استخدام دالتك الحالية (x-trends) التي ترجع مصفوفة الترندات
    // لا تغيّر اسمها؛ بس تأكد أنها ترجع Array كما هي الآن
    const limit = 10;
    const upstream = await fetch(`${process.env.URL}/.netlify/functions/x-trends?limit=${limit}`, {
      headers: { 'Accept': 'application/json' },
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      throw new Error(`upstream ${upstream.status}: ${text}`);
    }

    const arr = await upstream.json(); // يجب تكون Array
    if (!Array.isArray(arr)) throw new Error('upstream did not return an array');

    // خزّن في Netlify Blobs كـ JSON خام (مصفوفة فقط)
    const store = getStore('trends');
    await store.set('latest.json', JSON.stringify(arr), {
      contentType: 'application/json',
    });

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, count: arr.length }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
