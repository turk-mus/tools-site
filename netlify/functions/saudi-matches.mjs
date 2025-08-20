// netlify/functions/saudi-matches.mjs
import fetch from "node-fetch";
import fs from "fs";
import path from "path";

const TMP = "/tmp";
const CACHE_FILE = path.join(TMP, "saudi-matches-cache.json");
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 دقائق

// معرّف دوري روشن السعودي في TheSportsDB
const LEAGUE_ID = 4668;

// خريطة تحويل أسماء الفرق للغة العربية
const TEAMS_AR = {
  "Al-Hilal": "الهلال",
  "Al-Nassr": "النصر",
  "Al-Ittihad": "الاتحاد",
  "Al-Ahli": "الأهلي",
  "Al-Fateh": "الفتح",
  "Al-Raed": "الرائد",
  "Damac": "ضمك",
  "Abha": "أبها",
  "Al-Fayha": "الفيحاء",
  "Al-Taawoun": "التعاون",
  "Al-Ettifaq": "الاتفاق",
  "Al-Wehda": "الوحدة",
  "Al-Shabab": "الشباب",
  "Al-Khaleej": "الخليج",
  "Al-Hazem": "الحزم",
  "Al-Tai": "الطائي"
};

function translateTeam(name) {
  return TEAMS_AR[name] || name;
}

function normEvent(e) {
  return {
    idEvent: e.idEvent,
    date: e.dateEvent,
    time: e.strTime,
    timestamp: e.strTimestamp,
    home: translateTeam(e.strHomeTeam),
    away: translateTeam(e.strAwayTeam),
    homeScore: e.intHomeScore ?? null,
    awayScore: e.intAwayScore ?? null,
    venue: e.strVenue || null,
  };
}

function readCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = fs.readFileSync(CACHE_FILE, "utf8");
    const json = JSON.parse(raw);
    if (Date.now() - json.saved_at > CACHE_TTL_MS) return null;
    return json.payload;
  } catch { return null; }
}

function writeCache(payload) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ saved_at: Date.now(), payload }, null, 2), "utf8");
  } catch {}
}

export const handler = async () => {
  const hit = readCache();
  if (hit) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(hit),
    };
  }

  const base = "https://www.thesportsdb.com/api/v1/json/123";
  const urlPast = `${base}/eventspastleague.php?id=${LEAGUE_ID}`;
  const urlNext = `${base}/eventsnextleague.php?id=${LEAGUE_ID}`;

  const [pastJson, nextJson] = await Promise.all([
    fetch(urlPast).then(r => r.json()).catch(() => ({ events: [] })),
    fetch(urlNext).then(r => r.json()).catch(() => ({ events: [] })),
  ]);

  const past = (pastJson.events || [])
    .map(normEvent)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
    .reverse();

  const next = (nextJson.events || [])
    .map(normEvent)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  const payload = {
    ok: true,
    updated_at: new Date().toISOString(),
    past,
    next,
  };

  writeCache(payload);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  };
};
