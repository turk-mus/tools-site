// netlify/functions/saudi-matches.mjs
import fetch from "node-fetch";
import fs from "fs";
import path from "path";

const TMP = "/tmp";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 دقائق
const CACHE_FILE = (key) => path.join(TMP, `saudi-matches-${key}.json`);

// خرائط الدوريات (يمكن تعديل IDs إذا اختلفت لديك)
const SAUDI_LEAGUES = {
  pro:   { id: 4668, name: "دوري روشن السعودي" },
  first: { id: 4627, name: "دوري يلو للدرجة الأولى" },
  kings: { id: 5649, name: "كأس خادم الحرمين الشريفين" },
  super: { id: 5650, name: "كأس السوبر السعودي" },
};

// ترجمة الفرق للعربية
const TEAMS_AR = {
  "Al-Hilal": "الهلال", "Al-Nassr": "النصر", "Al-Ittihad": "الاتحاد",
  "Al-Ahli": "الأهلي", "Al-Fateh": "الفتح", "Al-Raed": "الرائد",
  "Damac": "ضمك", "Abha": "أبها", "Al-Fayha": "الفيحاء",
  "Al-Taawoun": "التعاون", "Al-Ettifaq": "الاتفاق", "Al-Wehda": "الوحدة",
  "Al-Shabab": "الشباب", "Al-Khaleej": "الخليج", "Al-Hazem": "الحزم",
  "Al-Tai": "الطائي", "Ohod": "أحد", "Hajer": "هجر", "Al-Qadsiah": "القادسية",
  "Al-Okhdood": "الأخدود", "Al-Riyadh": "الرياض", "Al-Ain": "العين",
  "Al-Adalah": "العدالة", "Al-Arabi": "العربي", "Al-Jabalain": "الجبلين",
  "Al-Orobah": "العروبة", "Al-Sahel": "الساحل", "Al-Jandal": "الجندل",
  "Al-Kawkab": "الكوكب", "Al-Jeel": "الجيل"
};

function translateTeam(name) {
  return TEAMS_AR[name] || name;
}

function pickLeague(params) {
  const q = new URLSearchParams(params || {});
  const alias = (q.get("league") || "pro").toLowerCase();
  const idParam = q.get("league_id");
  if (idParam && /^\d+$/.test(idParam)) {
    return { id: Number(idParam), name: "دوري مخصص" };
  }
  return SAUDI_LEAGUES[alias] || SAUDI_LEAGUES.pro;
}

function keyFrom(q) {
  const league = q.league || "pro";
  const league_id = q.league_id || "";
  const limit = q.limit || "2";
  const type = q.type || "both";
  return `${league}-${league_id}-${limit}-${type}`;
}

function readCache(key) {
  try {
    const file = CACHE_FILE(key);
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, "utf8");
    const json = JSON.parse(raw);
    if (Date.now() - json.saved_at > CACHE_TTL_MS) return null;
    return json.payload;
  } catch { return null; }
}

function writeCache(key, payload) {
  try {
    const file = CACHE_FILE(key);
    fs.writeFileSync(file, JSON.stringify({ saved_at: Date.now(), payload }, null, 2), "utf8");
  } catch {}
}

function toLocalTimeKSA(ts) {
  try {
    if (!ts) return null;
    const d = new Date(ts); // UTC
    const t = d.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Riyadh" });
    const day = d.toLocaleDateString("ar-SA", { timeZone: "Asia/Riyadh" });
    return { dateLocal: day, timeLocal: t };
  } catch { return null; }
}

function normEvent(e) {
  const ksa = toLocalTimeKSA(e.strTimestamp);
  return {
    idEvent: e.idEvent,
    date: e.dateEvent,
    time: e.strTime,
    timestamp: e.strTimestamp,
    dateLocal: ksa?.dateLocal || e.dateEventLocal || null,
    timeLocal: ksa?.timeLocal || e.strTimeLocal || null,
    home: translateTeam(e.strHomeTeam),
    away: translateTeam(e.strAwayTeam),
    homeScore: e.intHomeScore ?? null,
    awayScore: e.intAwayScore ?? null,
    venue: e.strVenue || null,
  };
}

export const handler = async (event) => {
  const q = event.queryStringParameters || {};
  const league = pickLeague(q);
  const limit = Math.max(1, Math.min(20, Number(q.limit) || 2)); // 1..20
  const want = (q.type || "both").toLowerCase(); // past | next | both
  const cacheKey = keyFrom(q);

  const hit = readCache(cacheKey);
  if (hit) {
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60"
      },
      body: JSON.stringify(hit),
    };
  }

  const base = "https://www.thesportsdb.com/api/v1/json/123";
  const urlPast = `${base}/eventspastleague.php?id=${league.id}`;
  const urlNext = `${base}/eventsnextleague.php?id=${league.id}`;

  const wantPast = want === "past" || want === "both";
  const wantNext = want === "next" || want === "both";

  const [pastJson, nextJson] = await Promise.all([
    wantPast ? fetch(urlPast).then(r => r.json()).catch(() => ({ events: [] })) : Promise.resolve({ events: [] }),
    wantNext ? fetch(urlNext).then(r => r.json()).catch(() => ({ events: [] })) : Promise.resolve({ events: [] }),
  ]);

  const past = (pastJson.events || [])
    .map(normEvent)
    .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")))
    .reverse()
    .slice(0, limit);

  const next = (nextJson.events || [])
    .map(normEvent)
    .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")))
    .slice(0, limit);

  const payload = {
    ok: true,
    updated_at: new Date().toISOString(),
    league: { id: league.id, name: league.name },
    limit,
    type: want,
    past,
    next,
  };

  writeCache(cacheKey, payload);

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60"
    },
    body: JSON.stringify(payload),
  };
};
