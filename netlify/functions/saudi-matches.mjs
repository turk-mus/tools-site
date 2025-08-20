// netlify/functions/saudi-matches.mjs
import fetch from "node-fetch";
import fs from "fs";
import path from "path";

const TMP = "/tmp";
const CACHE_FILE = path.join(TMP, "saudi-matches-cache.json");
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 دقائق

// مفاتيح الدوريات (يمكنك التعديل/الإضافة لاحقًا)
const SAUDI_LEAGUES = {
  pro: 4480,        // دوري روشن السعودي (Pro League)
  // first: 4627,   // (مثال) دوري يلو - حدث ID صحيح لاحقًا إن رغبت
  // kingscup: 4776 // (مثال) كأس الملك - حدث ID صحيح لاحقًا إن رغبت
};

function pickLeagueId(q) {
  const id = Number(q.league_id);
  if (!Number.isNaN(id) && id > 0) return id;
  const key = String(q.league || "pro").toLowerCase();
  return SAUDI_LEAGUES[key] || SAUDI_LEAGUES.pro;
}

function readTmpCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = fs.readFileSync(CACHE_FILE, "utf8");
    const json = JSON.parse(raw);
    if (Date.now() - json.saved_at > CACHE_TTL_MS) return null;
    return json.payload;
  } catch {
    return null;
  }
}

function writeTmpCache(payload) {
  try {
    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify({ saved_at: Date.now(), payload }, null, 2),
      "utf8"
    );
  } catch {}
}

function normEvent(e) {
  return {
    idEvent: e.idEvent,
    date: e.dateEvent,
    time: e.strTime,
    home: e.strHomeTeam,
    away: e.strAwayTeam,
    homeScore: e.intHomeScore ?? null,
    awayScore: e.intAwayScore ?? null,
    venue: e.strVenue || null,
  };
}

export const handler = async (event) => {
  const q = Object.fromEntries(new URLSearchParams(event.queryStringParameters || {}));
  const leagueId = pickLeagueId(q);
  const limit = Math.max(1, Math.min(10, Number(q.limit) || 2)); // 1..10
  const want = (q.type || "both").toLowerCase(); // "past" | "next" | "both"

  // حاول استخدام كاش /tmp أولًا
  const hit = readTmpCache();
  if (hit && hit.league_id === leagueId && hit.limit === limit && hit.type === want) {
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        // كاش CDN 5 دقائق + SWR دقيقة
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
      },
      body: JSON.stringify(hit),
    };
  }

  const base = "https://www.thesportsdb.com/api/v1/json/123";
  const urlPast = `${base}/eventspastleague.php?id=${leagueId}`;
  const urlNext = `${base}/eventsnextleague.php?id=${leagueId}`;

  const tasks = [];
  if (want === "past" || want === "both") tasks.push(fetch(urlPast).then(r => r.json()).catch(() => ({ events: [] })));
  else tasks.push(Promise.resolve({ events: [] }));

  if (want === "next" || want === "both") tasks.push(fetch(urlNext).then(r => r.json()).catch(() => ({ events: [] })));
  else tasks.push(Promise.resolve({ events: [] }));

  const [pastJson, nextJson] = await Promise.all(tasks);

  const past = (pastJson.events || [])
    .map(normEvent)
    .sort((a, b) => (a.date + (a.time||"")).localeCompare(b.date + (b.time||"")))
    .reverse()
    .slice(0, limit);

  const next = (nextJson.events || [])
    .map(normEvent)
    .sort((a, b) => (a.date + (a.time||"")).localeCompare(b.date + (b.time||"")))
    .slice(0, limit);

  const payload = {
    ok: true,
    updated_at: new Date().toISOString(),
    league_id: leagueId,
    limit,
    type: want,
    past,
    next,
  };

  // اكتب في كاش /tmp لمنطقة التنفيذ
  writeTmpCache(payload);

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // كاش CDN 5 دقائق + SWR دقيقة (يقلل الطلبات عالمياً ويحافظ على الحد)
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
    },
    body: JSON.stringify(payload),
  };
};
