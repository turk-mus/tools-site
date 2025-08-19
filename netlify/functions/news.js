// netlify/functions/news.js
const { XMLParser } = require("fast-xml-parser");

// —— المصادر ——
const FEEDS = [
  { url: "https://www.okaz.com.sa/rssFeed/0", source: "عكاظ" },
  { url: "https://saudigazette.com.sa/rssFeed/74", source: "Saudi Gazette" },
];

// —— كلمات محظورة (اخلاق/عنف/مقامرة...) ——
const BLOCKED_WORDS = [
  // عربي
  "اباحي","اباحيه","جنس","جنسي","خادش","مخل","دعاره","تحرش","اغتصاب",
  "قمار","مراهنات","رهان",
  "مخدرات","مخدر","تعاطي",
  "قتل","جريمه","جريمة","سفك","ذبح","اختطاف","تفجير","ارهاب","إرهاب","متطرف","تطرف",
  "عنصري","عنصرية","كراهيه","كراهية","شتم","سب",
  // إنجليزي
  "porn","xxx","nsfw","sex","sexual","explicit","nudity",
  "gambling","bet","casino",
  "drug","drugs","narcotic",
  "murder","rape","kidnap","terror","terrorism","extremist","hate","hateful"
];

// حصر الروابط على النطاقات الموثوقة (اختياري لكنه مفيد)
const ALLOW_DOMAIN_PARTS = [
  "okaz.com.sa",
  "saudigazette.com.sa",
];

// —— أدوات ——
function normalizeArabic(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/[ًٌٍَُِّْـٰ]/g, "")
    .replace(/[اإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

function containsBlocked(text = "") {
  const n = normalizeArabic(text);
  return BLOCKED_WORDS.some((w) => n.includes(normalizeArabic(w)));
}

function sameHostAllowed(link = "") {
  try {
    const u = new URL(link);
    return ALLOW_DOMAIN_PARTS.some((p) => u.hostname.endsWith(p));
  } catch {
    return true;
  }
}

function stripHtml(html = "") {
  return String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

exports.handler = async (event) => {
  const limit = Math.min(parseInt(event.queryStringParameters?.limit || "10", 10), 30);
  const SFW = event.queryStringParameters?.sfw === "1"; // وضع آمن

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    textNodeName: "text",
    parseTagValue: true,
    parseAttributeValue: true,
    trimValues: true,
  });

  const collected = [];

  for (const { url, source } of FEEDS) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "NetlifyFunction/1.0" } });
      if (!res.ok) throw new Error(`Bad status ${res.status}`);
      const xml = await res.text();
      const data = parser.parse(xml);

      const channel = data?.rss?.channel || data?.feed;
      let items = channel?.item || channel?.entry || [];
      if (!Array.isArray(items)) items = items ? [items] : [];

      for (const item of items) {
        const rawTitle = item?.title?.text ?? item?.title ?? "";
        const rawLink  = item?.link?.href ?? item?.link ?? "";
        const rawDate  = item?.pubDate ?? item?.published ?? item?.updated ?? null;
        const rawDesc  = item?.description?.text ?? item?.description ?? item?.summary ?? item?.content ?? "";

        const title = String(rawTitle).trim();
        const link  = String(rawLink).trim();
        const pub   = rawDate ? new Date(rawDate).toISOString() : null;
        const desc  = stripHtml(rawDesc);

        if (!title || !link) continue;

        if (SFW) {
          // فلترة أخلاقية + نطاقات فقط (ألغينا شرط التصنيفات لأنه كان يفلتر زيادة)
          if (containsBlocked(title) || containsBlocked(desc)) continue;
          if (!sameHostAllowed(link)) continue;
        }

        collected.push({ title, link, pubDate: pub, source });
      }
    } catch (err) {
      console.error("feed error:", url, err.message);
    }
  }

  // ترتيب بالأحدث
  collected.sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));

  // إزالة التكرار بالعنوان
  const unique = [];
  const seen = new Set();
  for (const it of collected) {
    if (!seen.has(it.title)) {
      seen.add(it.title);
      unique.push(it);
      if (unique.length >= limit) break;
    }
  }

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300"
    },
    body: JSON.stringify({ updatedAt: new Date().toISOString(), items: unique })
  };
};
