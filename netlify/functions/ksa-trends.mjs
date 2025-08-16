// netlify/functions/ksa-trends.mjs
export const handler = async () => {
  const X_BEARER  = process.env.X_BEARER;         // (اختياري) مفتاح X الرسمي
  const RAPID_KEY = process.env.RAPIDAPI_KEY;     // (اختياري) RapidAPI
  const RAPID_HOST= process.env.RAPIDAPI_HOST || 'twitter-trends-by-location.p.rapidapi.com';
  const KSA_WOEID = 23424938;

  // 1) القائمة البيضاء: عدّلها بحرّيتك (كلها بدون #)
  // ملاحظة: نطبّق "تطبيع" للنص قبل المقارنة (إزالة تشكيل/هاش/مسافات…)
  const ALLOWLIST = [
    // أمثلة عامة آمنة
    'السعودية','اليوم_الوطني','الذهب','الطقس','الرياض','جدة','مكة',
    // رياضة (أمثلة)
    'الهلال','النصر','الاتحاد','الأهلي','الدوري_السعودي',
    // تكنولوجيا / تعليم
    'تقنية','تعليم','برمجة',
  ].map(normalizeTag);

  // 2) قائمة احتياط آمنة (نستخدمها لملء الخانات الناقصة)
  const SAFE_FALLBACK = [
    '#السعودية', '#الذهب', '#الطقس', '#الرياض', '#جدة',
    '#مكة', '#الهلال', '#النصر', '#الاتحاد', '#الأهلي'
  ];

  // ————— مساعدات —————
  function normalizeTag(s='') {
    // نحذف الهاش والمسافات/المدود/التشكيل ونحوّل لأحرف موحدة
    let t = s.toString().trim();
    t = t.replace(/^#+/, '');           // شيل #
    t = t.replace(/\s+/g, '');          // شيل المسافات
    // إزالة التشكيل العربي
    t = t.normalize('NFKD').replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g,'');
    // توحيد الياء/الألف المقصورة والهمزات الشائعة
    t = t.replace(/ي|ى/g,'ي').replace(/أ|إ|آ/g,'ا').replace(/ۀ|ة/g,'ه');
    return t.toLowerCase();
  }

  function isAllowedTag(name='') {
    const n = normalizeTag(name);
    return ALLOWLIST.includes(n);
  }

  async function fetchFromX() {
    const url = `https://api.twitter.com/1.1/trends/place.json?id=${KSA_WOEID}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${X_BEARER}` }});
    if (!r.ok) throw new Error(`X API ${r.status}`);
    const j = await r.json();
    const trends = j?.[0]?.trends || [];
    return trends.map(t => ({ name: t.name, volume: t.tweet_volume, url: t.url }));
  }

  async function fetchFromRapid() {
    const url = `https://${RAPID_HOST}/trends?woeid=${KSA_WOEID}`;
    const r = await fetch(url, {
      headers: { 'X-RapidAPI-Key': RAPID_KEY, 'X-RapidAPI-Host': RAPID_HOST }
    });
    if (!r.ok) throw new Error(`RapidAPI ${r.status}`);
    const j = await r.json();
    const arr = j.trends || j.data || j || [];
    return arr.map(t => ({
      name: t.name || t.topic || t.title,
      volume: t.tweet_volume || t.volume || null,
      url: t.url || (t.name ? `https://x.com/search?q=${encodeURIComponent(t.name)}` : null)
    }));
  }

  try {
    // 3) اجلب الترند (إن وُجد مفتاح)، وإلا اعرض احتياطي آمن فقط
    let rows = [];
    if (X_BEARER)      rows = await fetchFromX();
    else if (RAPID_KEY)rows = await fetchFromRapid();

    // 4) خذ فقط الهاشتاقات (#...) والمسموح بها في القائمة البيضاء
    let safe = [];
    if (rows.length) {
      safe = rows
        .filter(x => x?.name && x.name.trim().startsWith('#'))
        .filter(x => isAllowedTag(x.name))
        .slice(0, 10);
    }

    // 5) إن لم نصل لـ 10 عناصر، نكمل من SAFE_FALLBACK (بدون تكرار)
    const have = new Set(safe.map(x => x.name.toLowerCase()));
    for (const tag of SAFE_FALLBACK) {
      if (safe.length >= 10) break;
      if (!have.has(tag.toLowerCase())) {
        safe.push({ name: tag, volume: null, url: `https://x.com/search?q=${encodeURIComponent(tag)}` });
        have.add(tag.toLowerCase());
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=120' },
      body: JSON.stringify({ updated_at: new Date().toISOString(), items: safe.slice(0,10) })
    };
  } catch (e) {
    // فشل الجلب؟ اعرض الاحتياطي الآمن فقط
    const items = SAFE_FALLBACK.slice(0,10).map(tag => ({
      name: tag, volume: null, url: `https://x.com/search?q=${encodeURIComponent(tag)}`
    }));
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=300' },
      body: JSON.stringify({ updated_at: new Date().toISOString(), items, fallback:true, error:e.message })
    };
  }
};
