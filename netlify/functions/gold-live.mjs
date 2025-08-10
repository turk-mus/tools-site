// netlify/functions/gold-live.mjs
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const handler = async () => {
  try {
    // نقرأ gold.json الموجود بجانب الدالة
    const filePath = path.join(__dirname, "gold.json");
    const raw = await fs.readFile(filePath, "utf-8");

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
      },
      body: raw,
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ ok: false, error: e?.message || "Failed to read gold.json" }),
    };
  }
};
