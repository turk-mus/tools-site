import { getStore } from '@netlify/blobs';

export const handler = async () => {
  try {
    const apiKey = process.env.GOLD_API_KEY;
    const siteID = process.env.NETLIFY_SITE_ID;
    const token  = process.env.NETLIFY_API_TOKEN;
    if (!apiKey || !siteID || !token) {
      return { statusCode: 500, body: 'Missing env: GOLD_API_KEY / NETLIFY_SITE_ID / NETLIFY_API_TOKEN' };
    }

    const res = await fetch('https://www.goldapi.io/api/XAU/USD', {
      headers: { 'x-access-token': apiKey, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return { statusCode: res.status, body: 'Gold API error' };

    const data = await res.json();

    const USD_TO_SAR = 3.75;
    const OUNCE_TO_GRAM = 31.1035;

    const price_ounce_usd = data.price;
    const price_ounce_sar = price_ounce_usd * USD_TO_SAR;
    const gram24 = price_ounce_sar / OUNCE_TO_GRAM;

    const payload = {
      price_ounce_usd,
      price_ounce_sar,
      exchange_rate: USD_TO_SAR,
      last_updated: new Date().toISOString(),
      grams: {
        "24": gram24,
        "22": gram24*(22/24),
        "21": gram24*(21/24),
        "18": gram24*(18/24),
        "14": gram24*(14/24),
      },
    };

    const store = getStore('gold', { siteID, token });
    await store.set('latest', JSON.stringify(payload));

    return { statusCode: 200, body: 'OK' };
  } catch (e) {
    return { statusCode: 500, body: 'update-gold error: ' + (e?.message || String(e)) };
  }
};
