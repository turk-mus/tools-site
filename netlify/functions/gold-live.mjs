// netlify/functions/gold-live.mjs
import fs from "fs/promises";
import path from "path";

export const handler = async () => {
  try {
    // gold.json الموجود في جذر المشروع (يتولّد أثناء الـ Deploy)
    const filePath = path.join(process.cwd(), "gold.json");
    const raw = await fs.readFile(filePath, "utf-8");

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        // لا نسمح بالكاش من المتصفح حتى تظهر أحدث نسخة
        "Cache-Control": "no-store, max-age=0",
      },
      body: raw,
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        ok: false,
        error: e?.message || "Failed to read gold.json",
      }),
    };
  }
};
