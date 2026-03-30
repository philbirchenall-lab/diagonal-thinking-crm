#!/usr/bin/env node
// Loads crm-import-data.json into the Google Sheets backend via the Apps Script API.
//
// Usage:
//   node load-initial-data.js "https://script.google.com/macros/s/AKfycb.../exec"
//
// The script throttles requests to ~5/s to stay well inside Apps Script quotas.
// Expect ~2–3 minutes for 379 records.

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const RATE_DELAY_MS = 200; // 5 req/s

function usage() {
  console.error("Usage: node load-initial-data.js <SHEETS_API_URL>");
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function postRecord(apiUrl, record) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ action: "upsert", record });
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
      // Follow redirects (Apps Script often 302s to the actual endpoint)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return postRecord(res.headers.location, record).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ raw: data });
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const apiUrl = process.argv[2];
  if (!apiUrl || !apiUrl.startsWith("http")) usage();

  const dataPath = path.resolve(__dirname, "../crm-import-data.json");
  if (!fs.existsSync(dataPath)) {
    console.error(`Cannot find ${dataPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(dataPath, "utf8");
  const records = JSON.parse(raw);

  if (!Array.isArray(records)) {
    console.error("crm-import-data.json must be a JSON array");
    process.exit(1);
  }

  console.log(`Loading ${records.length} records to ${apiUrl}`);
  console.log("This will take ~" + Math.ceil((records.length * RATE_DELAY_MS) / 60000) + " minute(s)...\n");

  let success = 0;
  let failed = 0;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    try {
      const result = await postRecord(apiUrl, record);
      if (result.error) {
        console.error(`[${i + 1}/${records.length}] ERROR for ${record.id}: ${result.error}`);
        failed++;
      } else {
        success++;
        if ((i + 1) % 25 === 0 || i === records.length - 1) {
          console.log(`[${i + 1}/${records.length}] ${success} ok, ${failed} failed`);
        }
      }
    } catch (err) {
      console.error(`[${i + 1}/${records.length}] FETCH ERROR for ${record.id}: ${err.message}`);
      failed++;
    }
    if (i < records.length - 1) await sleep(RATE_DELAY_MS);
  }

  console.log(`\nDone. ${success} inserted/updated, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main();
