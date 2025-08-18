import { getStore } from '@netlify/blobs';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const url = new URL(req.url);
  const country = url.searchParams.get('country') || (process.env.TRENDS_COUNTRY || 'SA');
  const limit = Math.max(1, Math.min(50, parseInt(url.searchParams.get('limit') || '10', 10)));

  const store = getStore('trends');
  const json = await store.get(`${country}.json`, { consistency: 'strong' });
  const data = json ? JSON.parse(json) : { country, updated_at: null, trends: [] };

  const body = JSON.stringify({
    country,
    updated_at: data.updated_at,
    trends: (data.trends || []).slice(0, limit)
  });

  return new Response(body, {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800'
    }
  });
};
