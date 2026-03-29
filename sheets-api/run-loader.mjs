import { readFileSync, existsSync } from "fs";
import { createRequire } from "module";
import https from "https";
import http from "http";

const API_URL = "https://script.google.com/macros/s/AKfycbwFmNgfr7EWbInhGQFA6KbZjXeLeiawId2sYKg1urX0JV5rl00DsPHYw3h-MnVJlBX2/exec";
const API_KEY = "DT-6256e0bc9c94c6998f5d206ebe4eb385";
const RATE_DELAY_MS = 200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function postRecord(apiUrl, record) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ action: "upsert", record, key: API_KEY });
    const parsed = new URL(apiUrl);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return postRecord(res.headers.location, record).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = join(__dirname, "../crm-import-data.json");
const records = JSON.parse(readFileSync(dataPath, "utf8"));

console.log(`Loading ${records.length} records...`);
console.log("Estimated time: ~" + Math.ceil((records.length * RATE_DELAY_MS) / 60000) + " minute(s)\n");

let success = 0, failed = 0;

for (let i = 0; i < records.length; i++) {
  const record = records[i];
  try {
    const result = await postRecord(API_URL, record);
    if (result.error) {
      console.error(`[${i+1}/${records.length}] ERROR for ${record.id}: ${result.error}`);
      failed++;
    } else {
      success++;
      if ((i+1) % 25 === 0 || i === records.length - 1) {
        console.log(`[${i+1}/${records.length}] ${success} ok, ${failed} failed`);
      }
    }
  } catch (err) {
    console.error(`[${i+1}/${records.length}] FETCH ERROR for ${record.id}: ${err.message}`);
    failed++;
  }
  if (i < records.length - 1) await sleep(RATE_DELAY_MS);
}

console.log(`\nDone. ${success} inserted/updated, ${failed} failed.`);
if (failed > 0) process.exit(1);
