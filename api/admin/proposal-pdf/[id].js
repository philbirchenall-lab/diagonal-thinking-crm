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
 *
 * PROP-PDF-002 v2 (25 Apr 2026): comprehensive brand and design fix at PDF
 * capture.
 *
 * v1 (held, never deployed) was fonts-only — injected Oswald + Source Sans 3
 * via Google Fonts to recover from the Sparticuz Chromium-min OpenSans
 * fallback. Pix's full design review on the rendered artefact (file
 * outputs/pix-proposal-pdf-design-review-2026-04-25.md) found the regression
 * was broader than fonts. Phil escalated: the cover composition, hierarchy,
 * decoration, page chrome, pull-quote treatment, fees presentation, and
 * pagination rules all need fixing in the same deploy. Phil verbatim: "There
 * will be no-one to stop us this time."
 *
 * v2 expands the puppeteer evaluation step so it injects:
 *   1. Google Fonts stylesheet for Oswald + Source Sans 3 (display=block).
 *   2. A comprehensive override CSS pack covering every P0 issue from the
 *      design review — cover composition, page chrome via @page margin
 *      boxes, pagination rules, pull-quote canonical callout, fees summary
 *      block treatment, identity beats, and a guard against dark mode.
 *
 * The override CSS pack canonical source is
 * outputs/pix-pdf-override-css-2026-04-25.css. Any future tuning lands there
 * first, then is folded back into the BRAND_OVERRIDE_CSS constant below.
 *
 * The proper fix still lives in dt-proposals (the print route layout,
 * next/font registration, semantic field naming on the cover, page-chrome
 * wiring with dynamic client name). Track B follow-up.
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

// Google Fonts stylesheet covering every weight and style used by the
// dt-proposals print template. display=block forces a render-blocking load
// so puppeteer never captures a fallback frame.
const BRAND_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Oswald:wght@400;500&family=Source+Sans+3:ital,wght@0,400;0,500;0,600;0,700;1,400&display=block";

// Comprehensive override CSS pack. Canonical source:
// ~/Documents/Claude/outputs/pix-pdf-override-css-2026-04-25.css
// Companion: ~/Documents/Claude/outputs/pix-proposal-pdf-design-review-2026-04-25.md
const BRAND_OVERRIDE_CSS = String.raw`
/* 1. Brand-font enforcement (P0-FONT-01) */
body, .proposal-document, .proposal-document p, .proposal-document li,
.proposal-para, .proposal-bullet-list li, .proposal-ordered-list li,
.proposal-table-cell, .proposal-quote, .proposal-contact-detail,
.proposal-label, .proposal-cover-meta-label, .proposal-cover-meta-value,
.proposal-footer, .ProseMirror, .ProseMirror p, .ProseMirror li {
  font-family: "Source Sans 3", "Source Sans 3 Fallback", Inter,
    "Helvetica Neue", Helvetica, Arial, sans-serif !important;
}
.proposal-document h1, .proposal-document h2, .proposal-document h3,
.proposal-heading, .proposal-subheading, .proposal-cover-title,
.proposal-cover-program, .proposal-table-header, .proposal-bold,
.proposal-signature-name, .client-access-card-title,
.proposal-label strong, .proposal-contact-detail strong,
.ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror th {
  font-family: "Oswald", "Oswald Fallback", "Bebas Neue", Impact,
    "Arial Narrow", sans-serif !important;
}

/* 2. Cover composition and hierarchy (P0-COVER-01..06) */
.proposal-cover::before {
  content: "" !important;
  background: #ffffff !important;
  border-radius: 0 !important;
  width: 100% !important;
  height: 3px !important;
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
}
.proposal-cover::after { content: none !important; display: none !important; }
.proposal-cover-brand-mark {
  top: 8% !important; left: 8% !important; width: min(44%, 92mm) !important;
}
.proposal-cover-bottom {
  bottom: 14% !important; left: 8% !important; right: 8% !important;
  max-width: 84% !important; gap: 28px !important;
}
.proposal-cover-title {
  font-family: "Oswald", "Oswald Fallback", sans-serif !important;
  font-size: clamp(40px, 5vw, 56px) !important;
  font-weight: 400 !important; line-height: 1.06 !important;
  letter-spacing: 0.02em !important; text-transform: uppercase !important;
  text-wrap: balance !important; color: #ffffff !important;
  margin: 0 0 14px 0 !important;
}
.proposal-cover-program {
  font-family: "Oswald", "Oswald Fallback", sans-serif !important;
  font-size: clamp(20px, 2.4vw, 26px) !important;
  font-weight: 400 !important; line-height: 1.18 !important;
  letter-spacing: 0.04em !important; text-transform: uppercase !important;
  text-wrap: balance !important;
  color: rgba(255, 255, 255, 0.92) !important;
  margin: 0 0 30px 0 !important;
}
.proposal-cover-meta {
  gap: 14px !important; max-width: 84% !important;
}
.proposal-cover-meta-row {
  grid-template-columns: minmax(120px, 30%) 1fr !important;
  gap: 24px !important; font-size: 14px !important; line-height: 1.55 !important;
}
.proposal-cover-meta-label {
  font-family: "Oswald", "Oswald Fallback", sans-serif !important;
  font-size: 12px !important; letter-spacing: 0.08em !important;
  text-transform: uppercase !important;
  color: rgba(255, 255, 255, 0.78) !important; font-weight: 400 !important;
}
.proposal-cover-meta-value {
  font-family: "Source Sans 3", "Source Sans 3 Fallback", sans-serif !important;
  color: rgba(255, 255, 255, 0.96) !important; font-weight: 400 !important;
}
.proposal-cover-brand-mark, .proposal-cover-brand-image {
  opacity: 1 !important; filter: none !important; mix-blend-mode: normal !important;
}

/* 3. Page chrome via @page margin boxes (P0-BODY-01) */
@page {
  size: a4;
  margin: 18mm 24mm 22mm 24mm;
}
@page {
  @top-left {
    content: "Diagonal Thinking · The AI Advantage";
    font-family: "Source Sans 3", sans-serif; font-size: 9pt;
    color: #5a6372; padding-top: 6mm;
  }
  @top-right {
    content: "Proposal";
    font-family: "Source Sans 3", sans-serif; font-size: 9pt;
    color: #5a6372; padding-top: 6mm;
  }
  @bottom-left {
    content: "Confidential";
    font-family: "Source Sans 3", sans-serif; font-size: 9pt;
    color: #5a6372; padding-bottom: 8mm;
  }
  @bottom-right {
    content: "Page " counter(page) " / " counter(pages);
    font-family: "Source Sans 3", sans-serif; font-size: 9pt;
    color: #5a6372; padding-bottom: 8mm;
  }
}
@page :first {
  margin: 0 !important;
}
@page :first {
  @top-left { content: ""; } @top-right { content: ""; }
  @bottom-left { content: ""; } @bottom-right { content: ""; }
}

/* 4. Body margins and breathing room (P0-BODY-02 / P1-BODY-06 / P1-GLOBAL-03) */
@media print {
  .proposal-cover {
    width: 210mm !important; height: 297mm !important;
    min-height: 297mm !important; margin: 0 !important;
  }
  .proposal-body { padding: 0 !important; }
  .proposal-closing-page { padding: 0 !important; }
  .proposal-document { width: 100% !important; max-width: 100% !important; }
  .proposal-footer { display: none !important; }
}

/* 5. Pagination — orphans, widows, heading binding (P0-BODY-03) */
.proposal-document h1, .proposal-document h2, .proposal-document h3,
.proposal-heading, .proposal-subheading {
  break-after: avoid-page !important; break-inside: avoid !important;
  page-break-after: avoid !important; page-break-inside: avoid !important;
}
.proposal-document h2 + p, .proposal-document h2 + ul,
.proposal-document h2 + ol, .proposal-document h2 + .proposal-bold,
.proposal-document h3 + p, .proposal-document h3 + ul,
.proposal-document h3 + ol, .proposal-document h3 + .proposal-label,
.proposal-document h3 + .proposal-bold {
  break-before: avoid-page !important; page-break-before: avoid !important;
}
.proposal-document p, .proposal-document li, .proposal-para,
.proposal-contact-detail {
  orphans: 3 !important; widows: 3 !important;
}
.proposal-table, .proposal-quote, .proposal-bullet-list,
.proposal-ordered-list {
  break-inside: avoid !important; page-break-inside: avoid !important;
}

/* 6. Pull-quote canonical callout (P0-BODY-04) */
.proposal-document blockquote, .proposal-quote, .ProseMirror blockquote {
  background: #A7A59F !important;
  border-left: 3px solid #305DAB !important;
  border-radius: 4px !important; color: #000000 !important;
  padding: 12px 16px !important; margin: 16px 0 !important;
  font-family: "Source Sans 3", sans-serif !important;
  font-size: 14px !important; line-height: 1.55 !important;
  font-style: normal !important;
  break-inside: avoid !important; page-break-inside: avoid !important;
}
.proposal-document blockquote p, .proposal-quote p,
.ProseMirror blockquote p {
  margin: 0 !important; color: #000000 !important;
}

/* 7. H3 typography refinement (P0-BODY-05) */
.proposal-document h3, .proposal-subheading {
  text-transform: none !important; letter-spacing: 0.005em !important;
  font-weight: 400 !important; font-size: 19px !important;
  line-height: 1.25 !important; margin-top: 26px !important;
  margin-bottom: 10px !important; color: #305DAB !important;
}

/* 8. Stage numbering (P1-BODY-07) — opt-in via .proposal-stage class */
.proposal-document { counter-reset: stage; }
.proposal-document h3.proposal-stage {
  counter-increment: stage;
  display: flex !important; align-items: baseline !important; gap: 14px !important;
}
.proposal-document h3.proposal-stage::before {
  content: counter(stage, decimal-leading-zero);
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px;
  border: 1px solid #A7A59F; border-radius: 4px;
  font-family: "Oswald", sans-serif; font-size: 11px;
  color: #305DAB; letter-spacing: 0.04em; flex-shrink: 0;
}

/* 9. Fees summary block (P1-BODY-08) — opt-in via .proposal-fees-list */
.proposal-fees-list {
  list-style: none !important; margin: 16px 0 !important;
  padding: 0 !important;
  border-top: 3px solid #305DAB !important;
  border-radius: 4px 4px 0 0 !important; background: #ffffff !important;
}
.proposal-fees-list li {
  display: flex !important; justify-content: space-between !important;
  align-items: baseline !important; padding: 10px 14px !important;
  border-bottom: 1px solid #e5e7eb !important;
  font-family: "Source Sans 3", sans-serif !important;
  font-size: 15px !important; line-height: 1.45 !important;
}
.proposal-fees-list li:last-child {
  border-bottom: none !important; border-top: 1px solid #305DAB !important;
  padding-top: 14px !important; font-weight: 600 !important; color: #305DAB !important;
}

/* 10. Identity beats and refinement (P2-GLOBAL-05 / P2-GLOBAL-04) */
.proposal-document .proposal-bold, .proposal-document .proposal-callout,
.proposal-document .proposal-summary-block {
  border-top: 3px solid #305DAB !important;
  background: #ffffff !important; padding: 14px 16px !important;
  margin: 18px 0 !important; border-radius: 4px 4px 0 0 !important;
}
.proposal-contact-detail a, .proposal-contact-detail strong {
  color: #305DAB !important; text-decoration: underline !important;
  text-decoration-color: rgba(48, 93, 171, 0.5) !important;
  text-underline-offset: 2px !important;
}

/* Final guard — force light palette for print regardless of system preference */
@media (prefers-color-scheme: dark) {
  html, body, .proposal-document, .proposal-body, .proposal-closing-page {
    background: #ffffff !important; color: #111111 !important;
  }
}
html, body { color-scheme: light !important; }
`;

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

    // PROP-PDF-002 v2: comprehensive brand + design enforcement before capture.
    //
    // Inject Google Fonts for Oswald + Source Sans 3, then layer Pix's full
    // override CSS pack on top. The pack covers every P0 issue from the
    // 25 Apr 2026 design review: fonts, cover composition + hierarchy +
    // decoration replacement, page chrome via @page margin boxes,
    // pagination rules, pull-quote on-brand callout, fees summary block
    // identity beat, dark-mode guard. Source: outputs/pix-pdf-override-css
    // -2026-04-25.css. Companion: outputs/pix-proposal-pdf-design-review
    // -2026-04-25.md.
    await page.evaluate(
      async (brandFontsHref, brandOverrideCss) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = brandFontsHref;
        document.head.appendChild(link);

        const override = document.createElement("style");
        override.id = "dt-brand-override-pack";
        override.textContent = brandOverrideCss;
        document.head.appendChild(override);

        // Wait for the Google Fonts stylesheet to load, then for every
        // declared FontFace to finish, then a short tail-wait for swap.
        await new Promise((resolve) => {
          if (link.sheet) return resolve();
          link.addEventListener("load", resolve, { once: true });
          link.addEventListener("error", resolve, { once: true });
          setTimeout(resolve, 3000);
        });
        if ("fonts" in document) {
          await document.fonts.ready;
        }
        await new Promise((r) => setTimeout(r, 500));
      },
      BRAND_FONTS_HREF,
      BRAND_OVERRIDE_CSS
    );

    // Force lazy images eager, scroll to trigger intersection observers, then
    // wait for every <img> to finish loading before capturing the PDF.
    await page.evaluate(async () => {
      document.querySelectorAll('img[loading="lazy"]').forEach((img) => {
        img.loading = "eager";
        img.src = img.src;
      });
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await Promise.all(
        Array.from(document.querySelectorAll("img")).map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise((resolve) => {
            img.addEventListener("load", resolve, { once: true });
            img.addEventListener("error", resolve, { once: true });
          });
        })
      );
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
    const buffer = Buffer.from(pdfBuffer);
    res.setHeader("Content-Length", buffer.length);
    return res.status(200).send(buffer);
  } catch (err) {
    console.error("[proposal-pdf] PDF generation failed:", err);
    return res.status(500).json({ error: "PDF generation failed." });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
