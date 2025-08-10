// scripts/fetch-gold.mjs
import fs from 'fs';
import path from 'path';

const API_KEY = process.env.GOLD_API_KEY;
if (!API_KEY) { console.error('Missing GOLD_API_KEY'); process.exit(1); }

const USD_TO_SAR = 3.75;
const OUNCE_TO_GRAM = 31.1035;

async function main() {
  const res = await fetch('https://www.goldapi.io/api/XAU/USD', {
    headers: { 'x-access-token': API_KEY, 'Content-Type': 'application/json' },
  });
  if (!res.ok) { console.error('Gold API error', res.status); process.exit(1); }
  const data = await res.json();

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

  // 1) اكتب نسخة في الجذر (كما السابق)
  const rootOut = path.join(process.cwd(), 'gold.json');
  fs.writeFileSync(rootOut, JSON.stringify(payload, null, 2), 'utf8');

  // 2) اكتب نسخة داخل netlify/functions/ لقراءتها من الدالة gold-live.mjs
  const fnDir = path.join(process.cwd(), 'netlify', 'functions');
  fs.mkdirSync(fnDir, { recursive: true }); // تأكد من وجود المجلد
  const fnOut = path.join(fnDir, 'gold.json');
  fs.writeFileSync(fnOut, JSON.stringify(payload, null, 2), 'utf8');

  console.log('✅ gold.json written to:');
  console.log('   -', rootOut);
  console.log('   -', fnOut);
}

main().catch(e => { console.error(e); process.exit(1); });
