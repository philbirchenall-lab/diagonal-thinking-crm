/**
 * api/admin/proposal-pdf/[id].js
 *
 * Admin-only: generate and download a proposal PDF server-side.
 *
 * GET /api/admin/proposal-pdf/:id
 *
 * Strategy: launch headless Chromium via @sparticuz/chromium-min and navigate
 * to the proposal's print page on proposals.diagonalthinking.co. That page is
 * server-side rendered directly from Supabase — no auth gate, no access log —
 * so the PDF is pixel-identical to what the client sees.
 *
 * The /p/[slug]/print route never writes to proposal_access_log, so this admin
 * download is completely invisible to client-facing analytics.
 *
 * Required env vars (same as other API routes):
 *   SUPABASE_URL or VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY or VITE_SUPABASE_ANON_KEY
 */

import { createClient } from "@supabase/supabase-js";
import chromium from "@sparticuz/chromium-min";
import puppeteer from "puppeteer-core";

const PROPOSALS_APP_URL = "https://proposals.diagonalthinking.co";

// Binary downloaded at runtime to stay within Vercel's 50 MB function size limit.
// Cached in /tmp across warm invocations.
const CHROMIUM_REMOTE_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar";

const CHROMIUM_ARGS = [
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-setuid-sandbox",
  "--no-first-run",
  "--no-sandbox",
  "--no-zygote",
  "--single-process",
];

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ error: "id is required" });
  }

  const supabase = getSupabase();

  const { data: proposal, error } = await supabase
    .from("proposals")
    .select("id, slug, client_name, footer_label")
    .eq("id", id)
    .single();

  if (error || !proposal) {
    return res.status(404).json({ error: "Proposal not found." });
  }

  if (!proposal.slug) {
    return res
      .status(400)
      .json({ error: "Proposal has no slug — cannot generate PDF." });
  }

  const printUrl = `${PROPOSALS_APP_URL}/p/${proposal.slug}/print`;

  let browser;
  try {
    const executablePath = await chromium.executablePath(CHROMIUM_REMOTE_URL);

    browser = await puppeteer.launch({
      args: CHROMIUM_ARGS,
      defaultViewport: { width: 1280, height: 960 },
      executablePath,
      headless: true,
    });

    const page = await browser.newPage();
    await page.emulateMediaType("print");
    await page.goto(printUrl, { waitUntil: "networkidle0" });
    await page.evaluate(async () => {
      if ("fonts" in document) {
        await document.fonts.ready;
      }
    });

    const pdfBuffer = await page.pdf({
      format: "A4",
      preferCSSPageSize: true,
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });

    const safeClient = (proposal.client_name ?? "proposal")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
    const filename = `${safeClient}-proposal.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    return res.status(200).send(pdfBuffer);
  } catch (err) {
    console.error("[proposal-pdf] PDF generation failed:", err);
    return res.status(500).json({ error: "PDF generation failed." });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
