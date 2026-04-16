/**
 * api/admin/proposal-pdf/[id].jsx
 *
 * Admin-only: generate and download a proposal PDF server-side.
 *
 * GET /api/admin/proposal-pdf/:id
 *
 * - Fetches proposal from Supabase by UUID
 * - Renders to PDF using @react-pdf/renderer (no headless browser)
 * - Returns as application/pdf attachment
 * - Does NOT check client email, does NOT write to proposal_access_log
 *
 * Required env vars (same as other API routes):
 *   SUPABASE_URL or VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY or VITE_SUPABASE_ANON_KEY
 */

import { createClient } from "@supabase/supabase-js";
import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";

// ─── Colours (matches web proposal CSS) ──────────────────────────────────────

const C = {
  coverBg: "#0d2d55",
  coverBgAccent: "#1b4f8a",
  coverBadge: "#6fa8dc",
  coverTitle: "#ffffff",
  coverSubtitle: "#a8c4e0",
  coverMeta: "#8ab4d6",
  coverMetaValue: "#ffffff",
  headingBlue: "#1b4f8a",
  bodyText: "#2d3640",
  listText: "#333333",
  footerText: "#9ca3af",
  divider: "#c7d8eb",
  pageBg: "#ffffff",
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    backgroundColor: C.pageBg,
    fontFamily: "Helvetica",
  },

  // Cover
  cover: {
    backgroundColor: C.coverBg,
    padding: "40 30 35 30",
  },
  coverBadge: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: C.coverBadge,
    letterSpacing: 2.5,
    textTransform: "uppercase",
    marginBottom: 14,
  },
  coverTitle: {
    fontSize: 24,
    fontFamily: "Helvetica-Bold",
    color: C.coverTitle,
    lineHeight: 1.25,
    marginBottom: 8,
  },
  coverSubtitle: {
    fontSize: 13,
    color: C.coverSubtitle,
    marginBottom: 22,
    lineHeight: 1.4,
  },
  coverDivider: {
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.12)",
    marginBottom: 14,
  },
  coverMetaRow: {
    flexDirection: "row",
    marginBottom: 5,
  },
  coverMetaLabel: {
    fontSize: 9,
    color: C.coverMeta,
    width: 80,
  },
  coverMetaValue: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: C.coverMetaValue,
    flex: 1,
  },

  // Body
  body: {
    padding: "24 30 20 30",
    flex: 1,
  },
  heading: {
    fontSize: 13.5,
    fontFamily: "Helvetica-Bold",
    color: C.headingBlue,
    marginTop: 18,
    marginBottom: 5,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: C.headingBlue,
  },
  headingFirst: {
    marginTop: 0,
  },
  para: {
    fontSize: 10.5,
    color: C.bodyText,
    lineHeight: 1.7,
    marginBottom: 7,
  },
  paraEmpty: {
    fontSize: 10.5,
    marginBottom: 5,
  },
  label: {
    fontSize: 10.5,
    color: C.bodyText,
    lineHeight: 1.7,
    marginBottom: 7,
  },
  bulletRow: {
    flexDirection: "row",
    marginBottom: 4,
    paddingLeft: 8,
  },
  bulletDot: {
    fontSize: 10.5,
    color: C.listText,
    width: 12,
    marginTop: 1,
  },
  bulletText: {
    fontSize: 10.5,
    color: C.listText,
    flex: 1,
    lineHeight: 1.6,
  },
  orderedRow: {
    flexDirection: "row",
    marginBottom: 4,
    paddingLeft: 8,
  },
  orderedNum: {
    fontSize: 10.5,
    color: C.listText,
    width: 18,
    marginTop: 1,
  },
  orderedText: {
    fontSize: 10.5,
    color: C.listText,
    flex: 1,
    lineHeight: 1.6,
  },
  hr: {
    borderTopWidth: 1,
    borderTopColor: C.divider,
    marginTop: 10,
    marginBottom: 10,
  },

  // Footer
  footer: {
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    padding: "8 30",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: {
    fontSize: 8,
    color: C.footerText,
  },
});

// ─── TipTap → React PDF renderers ─────────────────────────────────────────────

function renderInlineContent(nodes) {
  if (!nodes || nodes.length === 0) return null;
  return nodes.map((node, i) => {
    if (node.type !== "text") return null;
    const text = node.text ?? "";
    const isBold = node.marks?.some((m) => m.type === "bold");
    const isItalic = node.marks?.some((m) => m.type === "italic");
    if (isBold && isItalic) {
      return (
        <Text key={i} style={{ fontFamily: "Helvetica-BoldOblique" }}>
          {text}
        </Text>
      );
    }
    if (isBold) {
      return (
        <Text key={i} style={{ fontFamily: "Helvetica-Bold" }}>
          {text}
        </Text>
      );
    }
    if (isItalic) {
      return (
        <Text key={i} style={{ fontFamily: "Helvetica-Oblique" }}>
          {text}
        </Text>
      );
    }
    return <Text key={i}>{text}</Text>;
  });
}

function extractPlainText(nodes) {
  if (!nodes) return "";
  return nodes.map((n) => n.text ?? "").join("");
}

let _headingCount = 0;

function renderDocNode(node, index) {
  switch (node.type) {
    case "heading": {
      _headingCount++;
      const isFirst = _headingCount === 1;
      return (
        <Text
          key={index}
          style={[styles.heading, isFirst && styles.headingFirst]}
        >
          {extractPlainText(node.content)}
        </Text>
      );
    }
    case "paragraph": {
      const content = node.content ?? [];
      if (content.length === 0) {
        return <Text key={index} style={styles.paraEmpty}>{" "}</Text>;
      }
      // Label paragraph: first run is bold, second is plain
      const isLabel =
        node.attrs?.class === "label-paragraph" ||
        (content.length === 2 &&
          content[0].marks?.some((m) => m.type === "bold") &&
          !content[1].marks?.some((m) => m.type === "bold"));
      return (
        <Text key={index} style={isLabel ? styles.label : styles.para}>
          {renderInlineContent(content)}
        </Text>
      );
    }
    case "bulletList":
      return (
        <View key={index}>
          {(node.content ?? []).map((item, i) => {
            const text = (item.content ?? [])
              .flatMap((p) => p.content ?? [])
              .map((n) => n.text ?? "")
              .join("");
            const inlineNodes = (item.content ?? []).flatMap(
              (p) => p.content ?? [],
            );
            return (
              <View key={i} style={styles.bulletRow}>
                <Text style={styles.bulletDot}>•</Text>
                <Text style={styles.bulletText}>
                  {renderInlineContent(inlineNodes)}
                </Text>
              </View>
            );
          })}
        </View>
      );
    case "orderedList":
      return (
        <View key={index}>
          {(node.content ?? []).map((item, i) => {
            const inlineNodes = (item.content ?? []).flatMap(
              (p) => p.content ?? [],
            );
            return (
              <View key={i} style={styles.orderedRow}>
                <Text style={styles.orderedNum}>{i + 1}.</Text>
                <Text style={styles.orderedText}>
                  {renderInlineContent(inlineNodes)}
                </Text>
              </View>
            );
          })}
        </View>
      );
    case "horizontalRule":
      return <View key={index} style={styles.hr} />;
    default:
      return null;
  }
}

// ─── PDF Document component ────────────────────────────────────────────────────

function ProposalPDF({ proposal }) {
  // Reset heading counter for each render
  _headingCount = 0;

  const docNodes = proposal.tiptap_json?.content ?? [];

  return (
    <Document
      title={proposal.program_title ?? "Proposal"}
      author={proposal.prepared_by ?? "Diagonal Thinking"}
    >
      <Page size="A4" style={styles.page}>
        {/* Cover */}
        <View style={styles.cover}>
          <Text style={styles.coverBadge}>Proposal</Text>
          <Text style={styles.coverTitle}>
            {proposal.program_title || "Untitled Proposal"}
          </Text>
          {proposal.subtitle ? (
            <Text style={styles.coverSubtitle}>{proposal.subtitle}</Text>
          ) : null}
          <View style={styles.coverDivider} />
          {proposal.client_name ? (
            <View style={styles.coverMetaRow}>
              <Text style={styles.coverMetaLabel}>Client</Text>
              <Text style={styles.coverMetaValue}>{proposal.client_name}</Text>
            </View>
          ) : null}
          {proposal.prepared_for ? (
            <View style={styles.coverMetaRow}>
              <Text style={styles.coverMetaLabel}>Prepared for</Text>
              <Text style={styles.coverMetaValue}>{proposal.prepared_for}</Text>
            </View>
          ) : null}
          {proposal.date ? (
            <View style={styles.coverMetaRow}>
              <Text style={styles.coverMetaLabel}>Date</Text>
              <Text style={styles.coverMetaValue}>{proposal.date}</Text>
            </View>
          ) : null}
          {proposal.prepared_by ? (
            <View style={styles.coverMetaRow}>
              <Text style={styles.coverMetaLabel}>Prepared by</Text>
              <Text style={styles.coverMetaValue}>{proposal.prepared_by}</Text>
            </View>
          ) : null}
        </View>

        {/* Body */}
        <View style={styles.body}>
          {docNodes.map((node, i) => renderDocNode(node, i))}
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {proposal.footer_label || "The AI Advantage"}
          </Text>
          <Text style={styles.footerText}>
            {proposal.prepared_by || "Diagonal Thinking"}
          </Text>
        </View>
      </Page>
    </Document>
  );
}

// ─── Supabase client ──────────────────────────────────────────────────────────

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

// ─── Handler ──────────────────────────────────────────────────────────────────

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
    .select(
      "id, proposal_code, program_title, subtitle, client_name, prepared_for, prepared_by, date, footer_label, tiptap_json",
    )
    .eq("id", id)
    .single();

  if (error || !proposal) {
    return res.status(404).json({ error: "Proposal not found." });
  }

  let pdfBuffer;
  try {
    pdfBuffer = await renderToBuffer(<ProposalPDF proposal={proposal} />);
  } catch (err) {
    console.error("[proposal-pdf] renderToBuffer failed:", err);
    return res.status(500).json({ error: "PDF generation failed." });
  }

  const safeTitle = (proposal.program_title ?? "proposal")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  const filename = `proposal-${proposal.proposal_code ?? safeTitle}.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", pdfBuffer.length);
  return res.status(200).send(pdfBuffer);
}
