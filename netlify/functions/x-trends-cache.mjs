// netlify/functions/x-trends-cache.mjs
import { getStore } from '@netlify/blobs';

export const handler = async (event) => {
  const baseHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    // تقليل استدعاءات الدالة نفسها عبر CDN
    'Netlify-CDN-Cache-Control': 'public, s-maxage=900, stale-while-revalidate=60', // 15 دقيقة
    'Content-Type': 'application/json; charset=utf-8',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: baseHeaders, body: '' };

  try {
    const store = getStore('trends');
    const text = await store.get('latest.json', { type: 'text' });
    if (!text) {
      return { statusCode: 503, headers: baseHeaders, body: JSON.stringify({ ok: false, reason: 'cache-miss' }) };
    }
    // نرجع المصفوفة مباشرة (نفس شكل دالتك الحالية) لتجنّب تعديل الواجهة
    return { statusCode: 200, headers: baseHeaders, body: text };
  } catch (e) {
    return { statusCode: 500, headers: baseHeaders, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
