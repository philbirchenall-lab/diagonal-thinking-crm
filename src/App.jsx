import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import Papa from "papaparse";
import { loadContacts, saveAllContacts, upsertContact, isSupabaseMode, getSupabaseClient, loadProposals, saveProposal, deleteProposal, loadProposalAccesses, loadContactProposals, deleteContact as deleteContactApi, loadContactActivities, updateActivityStatus, markProposalReplied, saveContactResearch, loadContactOpportunities, loadAllOpportunities, saveOpportunity, updateOpportunityStage, deleteOpportunity, loadContactOpportunityTotals } from "./db.js";
import { signOut } from "./AuthWrapper.jsx";
import ProposalWriterForm from "./proposals/ProposalForm.jsx";
import { ClientAreaTab, ContactSessionsPanel } from "./clientArea.jsx";
import {
  Download,
  Eye,
  FileSpreadsheet,
  Filter,
  Link2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

// LOCAL_API_URL is managed by db.js - use loadContacts/saveAllContacts instead
const TYPE_OPTIONS = ["Client", "Warm Lead", "Cold Lead", "Mailing List"];
const PLATFORM_OPTIONS = [
  "ChatGPT",
  "Anthropic Claude",
  "Microsoft Copilot",
  "Google Gemini",
  "Other",
];

const SERVICE_OPTIONS = [
  "AI Advantage Course",
  "AI Agent Course",
  "AI Consultancy",
  "AI Talk",
  "AI Action Day",
  "AI Retainer",
  "Non-AI Work",
];
const SOURCE_OPTIONS = [
  "Invoices",
  "Income & Expenditure",
  "Gmail",
  "Squarespace",
  "Manual",
];
const FIELD_LABELS = {
  company: "Company / Organisation",
  contactName: "Contact Name",
  email: "Email Address",
  phone: "Phone",
  type: "Type",
  services: "Services",
  projectedValue: "Projected Value",
  notes: "Notes",
  source: "Source",
  dateAdded: "Date Added",
  lastUpdated: "Last Updated",
};
const IMPORT_FIELDS = [
  "company",
  "contactName",
  "email",
  "phone",
  "type",
  "services",
  "projectedValue",
  "notes",
  "source",
  ...SERVICE_OPTIONS,
];
const TYPE_STYLES = {
  Client: {
    dot: "bg-emerald-500",
    pill: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    chip: "bg-emerald-500",
  },
  "Warm Lead": {
    dot: "bg-blue-500",
    pill: "bg-blue-50 text-blue-700 ring-blue-200",
    chip: "bg-blue-500",
  },
  "Cold Lead": {
    dot: "bg-sky-500",
    pill: "bg-sky-50 text-sky-700 ring-sky-200",
    chip: "bg-sky-500",
  },
  "Mailing List": {
    dot: "bg-slate-400",
    pill: "bg-slate-100 text-slate-600 ring-slate-200",
    chip: "bg-slate-400",
  },
};
const TYPE_COLORS = {
  Client: "#305DAB",
  "Warm Lead": "#305DAB",
  "Cold Lead": "rgba(48, 93, 171, 0.4)",
  "Mailing List": "#A7A59F",
};

const STAGES = ["Identified", "Qualifying", "Proposal", "Negotiating", "Won", "Lost"];

const STAGE_STYLES = {
  Identified: "bg-slate-100 text-slate-600 ring-slate-200",
  Qualifying: "bg-blue-50 text-blue-700 ring-blue-200",
  Proposal: "bg-orange-50 text-orange-700 ring-orange-200",
  Negotiating: "bg-purple-50 text-purple-700 ring-purple-200",
  Won: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Lost: "bg-rose-50 text-rose-600 ring-rose-200",
};

const expectedInitialHeaders = [
  "Company / Organisation",
  "Contact Name",
  "Email Address",
  "Phone",
  "Type",
  "AI Advantage Course",
  "AI Consultancy",
  "AI Talk",
  "AI Action Day",
  "AI Retainer",
  "Non-AI Work",
  "Projected Value",
  "Notes",
  "Source",
];

let xlsxLoader;

const emptyContact = () => ({
  id: "",
  company: "",
  contactName: "",
  email: "",
  phone: "",
  type: "Warm Lead",
  services: [],
  totalClientValue: 0,
  liveWorkValue: 0,
  projectedValue: "",
  notes: "",
  source: "Manual",
  dateAdded: "",
  lastUpdated: "",
  networkPartner: false,
  platforms: [],
});

function formatCurrency(value) {
  const number = Number(value) || 0;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(number);
}

function formatCurrencyOrDash(value) {
  return Number(value) ? formatCurrency(value) : "-";
}

function formatDate(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function todayStamp() {
  return new Date().toISOString();
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function similarText(a, b) {
  const left = slugify(a);
  const right = slugify(b);
  if (!left || !right) return false;
  return (
    left === right ||
    left.includes(right) ||
    right.includes(left) ||
    left.replace(/\s/g, "") === right.replace(/\s/g, "")
  );
}

// Company autocomplete helpers
const ACRONYM_STOP_WORDS = new Set(["the", "of", "and", "&", "a", "an", "for", "in", "on", "at", "to"]);

function companyAcronym(name) {
  return name
    .split(/[\s\-–/]+/)
    .filter((w) => w.length > 0 && !ACRONYM_STOP_WORDS.has(w.toLowerCase()))
    .map((w) => w[0].toUpperCase())
    .join("");
}

function matchesCompanyQuery(query, companyName) {
  if (!query || !companyName) return false;
  const q = query.toLowerCase().trim();
  const name = companyName.toLowerCase();
  // Substring match (most common case)
  if (name.includes(q)) return true;
  // Acronym match - e.g. "MM" or "GMC" (2+ chars, no spaces)
  if (q.length >= 2 && !q.includes(" ")) {
    const acronym = companyAcronym(companyName).toLowerCase();
    if (acronym.startsWith(q)) return true;
  }
  return false;
}

function coerceBoolean(value) {
  const lowered = String(value ?? "")
    .trim()
    .toLowerCase();
  return ["yes", "true", "1", "y", "x"].includes(lowered);
}

function normaliseProjectedValue(value) {
  if (typeof value === "number") return value;
  const cleaned = String(value ?? "").replace(/[^\d.-]/g, "");
  return cleaned ? Number(cleaned) : 0;
}

function parseServices(rawValue) {
  if (Array.isArray(rawValue)) return rawValue.filter(Boolean);
  if (!rawValue) return [];
  return String(rawValue)
    .split(/[,;|]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => SERVICE_OPTIONS.includes(item));
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value) ?? fallback;
  } catch {
    return fallback;
  }
}

async function loadXlsx() {
  if (!xlsxLoader) {
    xlsxLoader = import("xlsx");
  }
  return xlsxLoader;
}

function createContactRecord(partial) {
  const now = todayStamp();
  return {
    ...emptyContact(),
    ...partial,
    id: partial.id || crypto.randomUUID(),
    services: [...new Set(parseServices(partial.services))],
    totalClientValue: Number(partial.totalClientValue) || 0,
    liveWorkValue: Number(partial.liveWorkValue) || 0,
    projectedValue: Number(partial.projectedValue) || 0,
    dateAdded: partial.dateAdded || now,
    lastUpdated: partial.lastUpdated || now,
  };
}

function exportRows(records) {
  return records.map((contact) => {
    const row = {
      "Company / Organisation": contact.company,
      "Contact Name": contact.contactName,
      "Email Address": contact.email,
      Phone: contact.phone,
      Type: contact.type,
      Services: contact.services.join(", "),
      "Projected Value": Number(contact.projectedValue) || 0,
      Notes: contact.notes,
      Source: contact.source,
      "Date Added": contact.dateAdded,
      "Last Updated": contact.lastUpdated,
    };

    SERVICE_OPTIONS.forEach((service) => {
      row[service] = contact.services.includes(service) ? "Yes" : "";
    });

    return row;
  });
}

function findDuplicate(existingRecords, candidate) {
  const email = slugify(candidate.email);
  if (email) {
    const emailMatch = existingRecords.find(
      (record) => slugify(record.email) === email,
    );
    if (emailMatch) return emailMatch;
  }

  return existingRecords.find(
    (record) =>
      similarText(record.company, candidate.company) &&
      similarText(record.contactName, candidate.contactName),
  );
}

function mergeContacts(existing, incoming) {
  return createContactRecord({
    ...existing,
    ...incoming,
    id: existing.id,
    dateAdded: existing.dateAdded,
    lastUpdated: todayStamp(),
    services: [...new Set([...(existing.services || []), ...(incoming.services || [])])],
    projectedValue:
      Number(incoming.projectedValue) || Number(existing.projectedValue) || 0,
    notes: [existing.notes, incoming.notes].filter(Boolean).join("\n\n").trim(),
  });
}

function parseImportedRecord(row, mapping) {
  const services = new Set();
  const serviceColumn = mapping.services;
  if (serviceColumn) {
    parseServices(row[serviceColumn]).forEach((service) => services.add(service));
  }

  SERVICE_OPTIONS.forEach((service) => {
    const column = mapping[service];
    if (column && coerceBoolean(row[column])) {
      services.add(service);
    }
  });

  return createContactRecord({
    company: row[mapping.company] ?? "",
    contactName: row[mapping.contactName] ?? "",
    email: row[mapping.email] ?? "",
    phone: row[mapping.phone] ?? "",
    type: TYPE_OPTIONS.includes(row[mapping.type]) ? row[mapping.type] : "Warm Lead",
    services: Array.from(services),
    projectedValue: normaliseProjectedValue(row[mapping.projectedValue]),
    notes: row[mapping.notes] ?? "",
    source: SOURCE_OPTIONS.includes(row[mapping.source]) ? row[mapping.source] : "Manual",
  });
}

function inferMapping(headers) {
  const map = {};

  IMPORT_FIELDS.forEach((field) => {
    const target = field in FIELD_LABELS ? FIELD_LABELS[field] : field;
    const match = headers.find(
      (header) =>
        slugify(header) === slugify(target) ||
        slugify(header).includes(slugify(target)) ||
        slugify(target).includes(slugify(header)),
    );

    if (match) map[field] = match;
  });

  return map;
}

function DetailField({ label, children }) {
  return (
    <label className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </div>
      {children}
    </label>
  );
}

function TextInput(props) {
  return (
    <input
      {...props}
      className="w-full rounded-md border border-line bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
    />
  );
}

function CompanyAutocomplete({ value, onChange, suggestions }) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  const matches = useMemo(() => {
    if (!value || value.length < 1) return [];
    return suggestions
      .filter((name) => matchesCompanyQuery(value, name) && name !== value)
      .slice(0, 6);
  }, [value, suggestions]);

  const showDropdown = open && matches.length > 0;

  function handleSelect(name) {
    onChange({ target: { value: name } });
    setOpen(false);
  }

  function handleKeyDown(e) {
    if (!showDropdown) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleSelect(matches[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => {
          onChange(e);
          setOpen(true);
          setHighlighted(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        className="w-full rounded-md border border-line bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
      />
      {showDropdown && (
        <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-md border border-line bg-white shadow-lg">
          {matches.map((name, i) => (
            <li
              key={name}
              onMouseDown={() => handleSelect(name)}
              className={`cursor-pointer px-4 py-2.5 text-sm transition ${
                i === highlighted
                  ? "bg-brand text-white"
                  : "text-ink hover:bg-mist"
              }`}
            >
              {name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SelectInput(props) {
  return (
    <select
      {...props}
      className="w-full rounded-md border border-line bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
    />
  );
}

function TextArea(props) {
  return (
    <textarea
      {...props}
      className="min-h-28 w-full rounded-md border border-line bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
    />
  );
}

function ModalShell({ title, subtitle, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 sm:px-4 sm:py-8">
      <div className="w-full max-w-5xl rounded-t-xl border border-line bg-white shadow-panel sm:rounded-xl">
        <div className="flex items-start justify-between border-b border-line px-5 py-4 sm:px-6 sm:py-5">
          <div>
            <h2 className="font-display text-2xl font-normal uppercase tracking-[0.02em] text-ink sm:text-3xl">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-md border border-line p-2 text-slate-500 transition hover:border-brand hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Proposals helpers ────────────────────────────────────────────────────────

function generateSlug(programTitle, clientName) {
  const s = `${programTitle}-${clientName}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return s.slice(0, 60) + "-" + Math.random().toString(36).slice(2, 6);
}

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function todayFormatted() {
  return new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

// ─── ProposalAccessPanel ──────────────────────────────────────────────────────

function ProposalAccessPanel({ proposal, onClose }) {
  const [accesses, setAccesses] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProposalAccesses(proposal.id)
      .then(setAccesses)
      .finally(() => setLoading(false));
  }, [proposal.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-t-xl bg-white shadow-xl sm:rounded-xl">
        <div className="flex items-center justify-between border-b border-line bg-white px-5 py-4">
          <div>
            <div className="font-semibold text-ink">{proposal.program_title}</div>
            <div className="text-xs text-slate-500">Access history · Code: {proposal.proposal_code}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close access history"
            className="min-h-[44px] min-w-[44px] rounded-md p-2 text-slate-400 hover:text-slate-600"
          >
            <X size={20} />
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto px-5 py-4">
          {loading && <div className="text-sm text-slate-500">Loading…</div>}
          {!loading && accesses.length === 0 && (
            <div className="text-sm text-slate-400 italic">No one has accessed this proposal yet.</div>
          )}
          {accesses.map((a) => (
            <div key={a.id} className="flex items-start justify-between border-b border-line py-3 text-sm last:border-0">
              <div>
                <div className="font-medium text-ink">{a.email}</div>
                <div className="text-xs text-slate-400">
                  {new Date(a.accessed_at).toLocaleString("en-GB")}
                </div>
              </div>
              {a.downloaded_pdf && (
                <span className="ml-2 rounded bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">PDF downloaded</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── ProposalForm ─────────────────────────────────────────────────────────────

function ProposalToolbarButton({ onClick, isActive, children, title }) {
  return (
    <button
      type="button"
      onMouseDown={(event) => {
        event.preventDefault();
        onClick();
      }}
      title={title}
      className={`rounded px-2.5 py-1.5 text-sm font-medium transition-colors ${
        isActive
          ? "border border-blue-300 bg-blue-100 text-blue-700"
          : "border border-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-900"
      }`}
    >
      {children}
    </button>
  );
}

function ProposalToolbarDivider() {
  return <div className="mx-1 h-6 w-px bg-gray-200" />;
}

function ProposalEditorToolbar({ editor }) {
  if (!editor) return null;

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b border-gray-200 bg-gray-50 p-2">
      <ProposalToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive("bold")}
        title="Bold"
      >
        <strong>B</strong>
      </ProposalToolbarButton>

      <ProposalToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive("italic")}
        title="Italic"
      >
        <em>I</em>
      </ProposalToolbarButton>

      <ProposalToolbarDivider />

      <ProposalToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={editor.isActive("heading", { level: 2 })}
        title="Heading 2"
      >
        H2
      </ProposalToolbarButton>

      <ProposalToolbarDivider />

      <ProposalToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive("bulletList")}
        title="Bullet list"
      >
        • List
      </ProposalToolbarButton>

      <ProposalToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive("orderedList")}
        title="Numbered list"
      >
        1. List
      </ProposalToolbarButton>

      <ProposalToolbarDivider />

      <ProposalToolbarButton
        onClick={() => editor.chain().focus().setParagraph().run()}
        isActive={editor.isActive("paragraph")}
        title="Paragraph"
      >
        ¶
      </ProposalToolbarButton>

      <ProposalToolbarButton
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        title="Horizontal rule"
      >
        ―
      </ProposalToolbarButton>

      <ProposalToolbarDivider />

      <ProposalToolbarButton onClick={() => editor.chain().focus().undo().run()} title="Undo">
        ↩
      </ProposalToolbarButton>

      <ProposalToolbarButton onClick={() => editor.chain().focus().redo().run()} title="Redo">
        ↪
      </ProposalToolbarButton>
    </div>
  );
}

function ProposalRichEditor({ initialContent, onChange }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Start writing your proposal..." }),
    ],
    content: initialContent || { type: "doc", content: [] },
    immediatelyRender: false,
    onUpdate: ({ editor: currentEditor }) => {
      onChange(currentEditor.getJSON());
    },
    editorProps: {
      attributes: {
        class: "proposal-document proposal-body",
      },
    },
  });

  useEffect(() => {
    if (!editor || !initialContent) return;
    const current = JSON.stringify(editor.getJSON());
    const next = JSON.stringify(initialContent);
    if (current !== next) {
      editor.commands.setContent(initialContent, { emitUpdate: false });
    }
  }, [editor, initialContent]);

  return (
    <div className="overflow-hidden rounded-md border border-gray-200">
      <ProposalEditorToolbar editor={editor} />
      <div className="proposal-editor-wrapper">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

const EMPTY_PROPOSAL_DOC = { type: "doc", content: [] };

function textNode(text, marks = []) {
  return { type: "text", text, ...(marks.length ? { marks } : {}) };
}

function paragraphNode(text) {
  return {
    type: "paragraph",
    content: text ? [textNode(text)] : [],
  };
}

function headingNode(text) {
  return {
    type: "heading",
    attrs: { level: 2 },
    content: text ? [textNode(text)] : [],
  };
}

function bulletListNode(items) {
  return {
    type: "bulletList",
    content: items.map((item) => ({
      type: "listItem",
      content: [paragraphNode(item)],
    })),
  };
}

function orderedListNode(items) {
  return {
    type: "orderedList",
    attrs: { start: 1 },
    content: items.map((item) => ({
      type: "listItem",
      content: [paragraphNode(item)],
    })),
  };
}

function buildGenericProposalDoc(programTitle) {
  const label = programTitle?.trim() || "this proposal";
  return {
    type: "doc",
    content: [
      paragraphNode(`Thank you for the opportunity to support ${label}. This proposal outlines a practical route from ambition to action, with a focus on clear outcomes, confident delivery, and tangible momentum.`),
      headingNode("Context"),
      paragraphNode("You are looking for support that is thoughtful, commercially grounded, and immediately useful. The intention is not simply to explore ideas, but to turn them into meaningful action within the organisation."),
      headingNode("What this proposal covers"),
      bulletListNode([
        "A tailored scope of work shaped around your goals",
        "Facilitation, strategic input, and practical delivery support",
        "Clear outputs, next steps, and ownership",
      ]),
      headingNode("Recommended approach"),
      paragraphNode("We would begin with a focused discovery phase to align on priorities, define the right shape of the work, and make sure the programme speaks directly to the people involved. From there, the work can be delivered in a format that balances strategic thinking with practical implementation."),
      headingNode("Indicative outputs"),
      orderedListNode([
        "Alignment on objectives, audience, and success criteria",
        "Delivery of the agreed workshop, programme, or intervention",
        "A clear follow-on plan with recommended next steps",
      ]),
      headingNode("Next steps"),
      paragraphNode("If this direction feels right, we can confirm scope, timings, and any delivery details, then move straight into preparation."),
    ],
  };
}

function buildWorkshopProposalDoc(programTitle) {
  const label = programTitle?.trim() || "the workshop";
  return {
    type: "doc",
    content: [
      paragraphNode(`${label} is designed to help the group move from curiosity to confident action. The session combines strategic framing, hands-on exploration, and structured discussion so participants leave with clarity as well as momentum.`),
      headingNode("Workshop aims"),
      bulletListNode([
        "Build shared understanding of the opportunity",
        "Identify the most valuable use cases and priorities",
        "Turn insights into clear, practical next steps",
      ]),
      headingNode("What the session includes"),
      bulletListNode([
        "Pre-session alignment on goals and audience",
        "Facilitated workshop design and delivery",
        "Examples, prompts, and live exploration where useful",
        "A summary of outputs and recommendations afterwards",
      ]),
      headingNode("Outputs"),
      paragraphNode("The session will produce a stronger shared picture of where value sits, what to prioritise next, and how to keep momentum after the workshop."),
      headingNode("Suggested follow-on"),
      paragraphNode("Depending on the outcome of the workshop, we can then move into deeper advisory support, team capability-building, or focused prototype work."),
    ],
  };
}

function proposalDocHasMeaningfulContent(doc) {
  const content = Array.isArray(doc?.content) ? doc.content : [];
  return content.some((node) => {
    if (node.type === "horizontalRule") return true;
    if (node.type === "heading" || node.type === "paragraph") {
      return Array.isArray(node.content) && node.content.some((item) => item.text?.trim());
    }
    if (node.type === "bulletList" || node.type === "orderedList") {
      return Array.isArray(node.content) && node.content.length > 0;
    }
    return false;
  });
}

function renderProposalInline(nodes, keyPrefix) {
  return (nodes ?? []).map((node, index) => {
    const key = `${keyPrefix}-inline-${index}`;

    if (node.type === "text") {
      let content = node.text ?? "";
      (node.marks ?? []).forEach((mark) => {
        if (mark.type === "bold") content = <strong key={`${key}-bold`}>{content}</strong>;
        if (mark.type === "italic") content = <em key={`${key}-italic`}>{content}</em>;
      });
      return <span key={key}>{content}</span>;
    }

    if (node.type === "hardBreak") {
      return <br key={key} />;
    }

    return null;
  });
}

function renderProposalBlocks(nodes, keyPrefix = "proposal") {
  return (nodes ?? []).map((node, index) => {
    const key = `${keyPrefix}-${index}`;

    if (node.type === "paragraph") {
      return <p key={key}>{renderProposalInline(node.content, key)}</p>;
    }

    if (node.type === "heading") {
      return <h2 key={key}>{renderProposalInline(node.content, key)}</h2>;
    }

    if (node.type === "bulletList") {
      return (
        <ul key={key}>
          {(node.content ?? []).map((item, itemIndex) => (
            <li key={`${key}-item-${itemIndex}`}>
              {renderProposalBlocks(item.content, `${key}-item-${itemIndex}`)}
            </li>
          ))}
        </ul>
      );
    }

    if (node.type === "orderedList") {
      return (
        <ol key={key}>
          {(node.content ?? []).map((item, itemIndex) => (
            <li key={`${key}-item-${itemIndex}`}>
              {renderProposalBlocks(item.content, `${key}-item-${itemIndex}`)}
            </li>
          ))}
        </ol>
      );
    }

    if (node.type === "blockquote") {
      return <blockquote key={key}>{renderProposalBlocks(node.content, key)}</blockquote>;
    }

    if (node.type === "horizontalRule") {
      return <hr key={key} />;
    }

    return null;
  });
}

function ProposalForm({ proposal, contacts, onSave, onClose }) {
  const isNew = !proposal;
  const draftKey = proposal?.id ? `crm-proposal-draft-${proposal.id}` : "crm-proposal-draft-new";
  const [form, setForm] = useState({
    clientName: proposal?.client_name ?? proposal?.prepared_for ?? "",
    programTitle: proposal?.program_title ?? "",
    subtitle: proposal?.subtitle ?? "",
    preparedFor: proposal?.prepared_for ?? "",
    preparedBy: proposal?.prepared_by ?? "Phil Birchenall, DIAGONAL // THINKING",
    proposalCode: proposal?.proposal_code ?? "",
    date: proposal?.date ?? todayFormatted(),
    footerLabel: proposal?.footer_label ?? "The AI Advantage",
    isActive: proposal?.is_active ?? true,
    contactId: proposal?.contact_id ?? null,
  });
  const [doc, setDoc] = useState(() => {
    if (proposal?.tiptap_json && proposalDocHasMeaningfulContent(proposal.tiptap_json)) {
      return proposal.tiptap_json;
    }
    return buildGenericProposalDoc(proposal?.program_title);
  });
  const [contactSearch, setContactSearch] = useState(
    proposal?.contacts ? `${proposal.contacts.contact_name ?? ""}, ${proposal.contacts.company ?? ""}` : ""
  );
  const [showContactDropdown, setShowContactDropdown] = useState(false);
  const [viewMode, setViewMode] = useState("write");
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const filteredContacts = contacts.filter((c) => {
    const q = contactSearch.toLowerCase();
    return (
      c.contactName.toLowerCase().includes(q) ||
      c.company.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q)
    );
  }).slice(0, 8);

  const baselineRef = useRef(
    JSON.stringify({
      form: {
        clientName: proposal?.client_name ?? proposal?.prepared_for ?? "",
        programTitle: proposal?.program_title ?? "",
        subtitle: proposal?.subtitle ?? "",
        preparedFor: proposal?.prepared_for ?? "",
        preparedBy: proposal?.prepared_by ?? "Phil Birchenall, DIAGONAL // THINKING",
        proposalCode: proposal?.proposal_code ?? "",
        date: proposal?.date ?? todayFormatted(),
        footerLabel: proposal?.footer_label ?? "The AI Advantage",
        isActive: proposal?.is_active ?? true,
        contactId: proposal?.contact_id ?? null,
      },
      doc: proposal?.tiptap_json && proposalDocHasMeaningfulContent(proposal.tiptap_json)
        ? proposal.tiptap_json
        : buildGenericProposalDoc(proposal?.program_title),
    })
  );

  useEffect(() => {
    const raw = localStorage.getItem(draftKey);
    if (!raw) return;
    const parsed = safeJsonParse(raw, null);
    if (!parsed?.form || !parsed?.doc) return;
    setForm((current) => ({ ...current, ...parsed.form }));
    setDoc(parsed.doc);
    if (parsed.form.contactId) {
      const selectedContact = contacts.find((contact) => contact.id === parsed.form.contactId);
      if (selectedContact) {
        setContactSearch(`${selectedContact.contactName}, ${selectedContact.company}`);
      }
    }
    setRestoredDraft(true);
  }, [draftKey, contacts]);

  useEffect(() => {
    localStorage.setItem(draftKey, JSON.stringify({ form, doc }));
  }, [draftKey, form, doc]);

  const isDirty =
    JSON.stringify({ form, doc }) !== baselineRef.current;

  function closeWithGuard() {
    if (isDirty && !confirm("Close the proposal editor? You have unsaved changes.")) return;
    onClose();
  }

  function selectContact(c) {
    setForm((f) => ({
      ...f,
      contactId: c.id,
      clientName: c.company || c.contactName,
      preparedFor: [c.contactName, c.company].filter(Boolean).join(", "),
    }));
    setContactSearch(`${c.contactName}, ${c.company}`);
    setShowContactDropdown(false);
  }

  function applyTemplate(kind) {
    if (
      proposalDocHasMeaningfulContent(doc) &&
      !confirm("Replace the current proposal body with a starter template?")
    ) {
      return;
    }
    const nextDoc =
      kind === "workshop"
        ? buildWorkshopProposalDoc(form.programTitle)
        : buildGenericProposalDoc(form.programTitle);
    setDoc(nextDoc);
    setViewMode("write");
  }

  function importPlainText() {
    const text = window.prompt("Paste the proposal text you want to import into the editor.");
    if (!text?.trim()) return;
    const paragraphs = text
      .split(/\n{2,}/)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => paragraphNode(chunk.replace(/\n/g, " ")));
    if (!paragraphs.length) return;
    setDoc({ type: "doc", content: paragraphs });
    setViewMode("write");
  }

  async function handleSave() {
    if (!form.programTitle.trim()) { setError("Program title is required."); return; }
    if (!form.preparedFor.trim()) { setError("Prepared for is required."); return; }
    setSaving(true);
    setError(null);
    try {
      const slug = proposal?.slug ?? generateSlug(form.programTitle, form.clientName || form.preparedFor || "proposal");
      const code = form.proposalCode || generateCode();
      await saveProposal({
        id: proposal?.id,
        slug,
        proposalCode: code,
        clientName: form.clientName || form.preparedFor || form.programTitle,
        programTitle: form.programTitle,
        subtitle: form.subtitle,
        preparedFor: form.preparedFor,
        preparedBy: form.preparedBy,
        date: form.date,
        footerLabel: form.footerLabel || "The AI Advantage",
        isActive: form.isActive,
        contactId: form.contactId,
        tiptapJson: doc,
      });
      localStorage.removeItem(draftKey);
      onSave();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-10">
      <div className="w-full max-w-7xl overflow-hidden rounded-xl border border-line bg-white shadow-2xl">
        <div className="flex flex-col gap-3 border-b border-line bg-white px-5 py-4 sm:px-6 sm:py-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-ink">{isNew ? "New Proposal" : "Edit Proposal"}</div>
            <div className="mt-1 text-sm text-slate-500">
              Write and shape the full client-facing proposal here, then save it back into the CRM.
            </div>
            {restoredDraft && (
              <div className="mt-3 inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                Unsaved draft restored from this browser
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setViewMode("write")}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                viewMode === "write"
                  ? "bg-brand text-white"
                  : "border border-line text-slate-600 hover:bg-slate-50"
              }`}
            >
              Write
            </button>
            <button
              type="button"
              onClick={() => setViewMode("preview")}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                viewMode === "preview"
                  ? "bg-brand text-white"
                  : "border border-line text-slate-600 hover:bg-slate-50"
              }`}
            >
              Preview
            </button>
            {proposal?.proposal_code && (
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(proposal.proposal_code);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="rounded-full border border-line px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                {copied ? "Code copied" : `Copy code: ${proposal.proposal_code}`}
              </button>
            )}
          </div>
          <button type="button" onClick={closeWithGuard} className="min-h-[44px] min-w-[44px] self-start rounded-md p-2 text-slate-400 hover:text-slate-600 lg:self-auto">
            <X size={20} />
          </button>
        </div>
        <div className="grid gap-0 lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="space-y-6 border-b border-line bg-slate-50/70 px-6 py-6 lg:border-b-0 lg:border-r">
            <div className="space-y-4">
              <div className="relative">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Contact</label>
                <input
                  type="text"
                  value={contactSearch}
                  onChange={(e) => { setContactSearch(e.target.value); setShowContactDropdown(true); }}
                  onFocus={() => setShowContactDropdown(true)}
                  placeholder="Search by name, company, or email..."
                  className="w-full rounded-md border border-line px-3 py-2 text-sm focus:border-brand focus:outline-none"
                />
                {showContactDropdown && filteredContacts.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border border-line bg-white shadow-lg">
                    {filteredContacts.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={() => selectContact(c)}
                        className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-slate-50"
                      >
                        <span className="font-medium text-ink">{c.contactName}</span>
                        <span className="text-xs text-slate-400">{[c.company, c.email].filter(Boolean).join(" · ")}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {[
                { key: "programTitle", label: "Program title", placeholder: "e.g. Agent Action Day" },
                { key: "subtitle", label: "Subtitle", placeholder: "e.g. TACE prototype development workshop" },
                { key: "clientName", label: "Client name", placeholder: "e.g. TACE" },
                { key: "preparedFor", label: "Prepared for", placeholder: "e.g. Jim Massey, TACE" },
                { key: "preparedBy", label: "Prepared by", placeholder: "e.g. Phil Birchenall, DIAGONAL // THINKING" },
                { key: "date", label: "Date", placeholder: "e.g. 31 March 2026" },
                { key: "footerLabel", label: "Footer label", placeholder: "e.g. The AI Advantage" },
              ].map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</label>
                  <input
                    type="text"
                    value={form[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full rounded-md border border-line px-3 py-2 text-sm focus:border-brand focus:outline-none"
                  />
                </div>
              ))}

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Proposal code</label>
                <div className="w-full rounded-md border border-line bg-slate-50 px-3 py-2 text-sm font-mono text-slate-500">
                  {form.proposalCode || <span className="italic">Auto-generated on save</span>}
                </div>
              </div>

              <label className="flex items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                  className="h-4 w-4 accent-brand"
                />
                Active proposal
              </label>
            </div>

            <div className="space-y-2 border-t border-line pt-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quick start</div>
              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={() => applyTemplate("generic")}
                  className="rounded-md border border-line bg-white px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                >
                  Generic proposal template
                </button>
                <button
                  type="button"
                  onClick={() => applyTemplate("workshop")}
                  className="rounded-md border border-line bg-white px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                >
                  Workshop proposal template
                </button>
                <button
                  type="button"
                  onClick={importPlainText}
                  className="rounded-md border border-line bg-white px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                >
                  Paste plain text into the editor
                </button>
              </div>
            </div>
          </aside>

          <section className="space-y-4 px-6 py-6">
            <div className="rounded-xl border border-line bg-slate-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Proposal body</div>
              <div className="mt-1 text-sm text-slate-500">
                Use the toolbar to shape sections, lists, and emphasis. The saved document controls how the client-facing proposal is rendered.
              </div>
            </div>

            {viewMode === "write" ? (
              <ProposalRichEditor initialContent={doc} onChange={setDoc} />
            ) : (
              <div className="proposal-editor-preview rounded-xl border border-line bg-slate-100 p-4">
                <div className="proposal-document proposal-body">
                  {proposalDocHasMeaningfulContent(doc) ? (
                    renderProposalBlocks(doc.content)
                  ) : (
                    <p className="text-slate-400">This proposal body is still empty.</p>
                  )}
                </div>
              </div>
            )}

            {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          </section>
        </div>
        <div className="flex flex-col gap-3 border-t border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="text-xs text-slate-400">
            {isDirty ? "Unsaved changes" : "All changes saved in this draft session"}
          </div>
          <div className="flex justify-end gap-2">
          <button type="button" onClick={closeWithGuard} className="min-h-[44px] rounded-md border border-line px-4 py-2 text-sm text-slate-500 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="min-h-[44px] rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Proposal"}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ContactProposalsPanel ────────────────────────────────────────────────────

const PROPOSALS_PDF_BASE = "https://proposals.diagonalthinking.co/api/proposals";

function ContactProposalsPanel({ contact, onReplied }) {
  const [proposals, setProposals] = useState(null); // null = loading
  const [markingReplied, setMarkingReplied] = useState(null);

  function load() {
    if (!isSupabaseMode()) {
      setProposals([]);
      return;
    }
    setProposals(null);
    loadContactProposals(contact)
      .then((data) => setProposals(data))
      .catch((err) => {
        console.error(err);
        setProposals([]);
      });
  }

  useEffect(() => { load(); }, [contact.id]);

  async function handleMarkReplied(proposalId) {
    setMarkingReplied(proposalId);
    try {
      await markProposalReplied(proposalId);
      load();
      if (onReplied) onReplied();
    } catch (err) {
      console.error(err);
    } finally {
      setMarkingReplied(null);
    }
  }

  return (
    <div className="border border-line bg-white p-5">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        Proposals
      </div>

      {proposals === null && (
        <div className="mt-3 text-xs text-slate-400">Loading…</div>
      )}

      {proposals !== null && proposals.length === 0 && (
        <div className="mt-3 text-xs italic text-slate-400">No proposals sent yet.</div>
      )}

      {proposals !== null && proposals.length > 0 && (
        <div className="mt-3 space-y-3">
          {proposals.map((p) => (
            <div key={p.id} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
              <div className="text-sm font-medium text-ink leading-snug">{p.program_title}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-xs text-slate-400">{p.date}</span>
                {p.views === 0 ? (
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-400 ring-1 ring-inset ring-slate-200">
                    Not opened
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                    Opened ({p.views} {p.views === 1 ? "view" : "views"})
                  </span>
                )}
                {p.reply_received && (
                  <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200">
                    Replied
                  </span>
                )}
                {p.slug && (
                  <a
                    href={`${PROPOSALS_PDF_BASE}/${p.slug}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-brand hover:underline"
                  >
                    Preview PDF
                  </a>
                )}
              </div>
              {p.views > 0 && !p.reply_received && (
                <button
                  type="button"
                  onClick={() => handleMarkReplied(p.id)}
                  disabled={markingReplied === p.id}
                  className="mt-2 inline-flex items-center rounded border border-line px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  {markingReplied === p.id ? "Saving…" : "Mark as replied"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ContactActivitiesPanel ───────────────────────────────────────────────────

const ACTIVITY_TYPE_LABELS = {
  email_sent: "Email sent",
  linkedin_draft: "LinkedIn",
  email_received: "Email received",
  note: "Note",
};

const ACTIVITY_TYPE_ICONS = {
  email_sent: "✉️",
  linkedin_draft: "🔗",
  email_received: "📨",
  note: "📝",
};

function ActivityStatusBadge({ status }) {
  if (status === "sent") {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
        Sent
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
        Pending
      </span>
    );
  }
  if (status === "received") {
    return (
      <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200">
        Received
      </span>
    );
  }
  return null;
}

function ContactActivitiesPanel({ contact, refreshKey }) {
  const [activities, setActivities] = useState(null); // null = loading
  const [markingSent, setMarkingSent] = useState(null);

  function load() {
    if (!isSupabaseMode()) {
      setActivities([]);
      return;
    }
    setActivities(null);
    loadContactActivities(contact.id)
      .then((data) => setActivities(data))
      .catch((err) => {
        console.error(err);
        setActivities([]);
      });
  }

  useEffect(() => { load(); }, [contact.id, refreshKey]);

  async function handleMarkSent(activityId) {
    setMarkingSent(activityId);
    try {
      await updateActivityStatus(activityId, "sent");
      load();
    } catch (err) {
      console.error(err);
    } finally {
      setMarkingSent(null);
    }
  }

  return (
    <div className="border border-line bg-white p-5">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        Activity
      </div>

      {activities === null && (
        <div className="mt-3 text-xs text-slate-400">Loading…</div>
      )}

      {activities !== null && activities.length === 0 && (
        <div className="mt-3 text-xs italic text-slate-400">No activity recorded yet.</div>
      )}

      {activities !== null && activities.length > 0 && (
        <div className="mt-3 space-y-3">
          {activities.map((a) => (
            <div key={a.id} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm" aria-hidden="true">
                    {ACTIVITY_TYPE_ICONS[a.activity_type] ?? "📋"}
                  </span>
                  <span className="text-sm font-medium text-ink leading-snug truncate">
                    {a.subject || ACTIVITY_TYPE_LABELS[a.activity_type] || a.activity_type}
                  </span>
                </div>
                <ActivityStatusBadge status={a.status} />
              </div>
              <div className="mt-0.5 text-xs text-slate-400">
                {new Date(a.created_at).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </div>
              {a.activity_type === "linkedin_draft" && a.status === "pending" && (
                <div className="mt-2">
                  <p className="text-xs text-slate-600 bg-slate-50 border border-line rounded p-2 leading-relaxed">
                    {a.body}
                  </p>
                  <button
                    type="button"
                    onClick={() => handleMarkSent(a.id)}
                    disabled={markingSent === a.id}
                    className="mt-2 inline-flex items-center rounded border border-line px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {markingSent === a.id ? "Saving…" : "Mark as sent"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ContactOpportunitiesPanel ────────────────────────────────────────────────

function StageBadge({ stage }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STAGE_STYLES[stage] ?? "bg-slate-100 text-slate-600 ring-slate-200"}`}>
      {stage}
    </span>
  );
}

const emptyOppForm = () => ({
  title: "",
  description: "",
  value: "",
  stage: "Identified",
  services: [],
  closeDate: "",
  notes: "",
  proposalId: null,
});

function OpportunityForm({ initial = null, contactId, onSave, onCancel }) {
  const [form, setForm] = useState(initial ?? emptyOppForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [proposals, setProposals] = useState([]);

  useEffect(() => {
    if (!isSupabaseMode()) return;
    loadProposals().then((all) => {
      // Prefer proposals linked to this contact; fall back to all if none match
      const forContact = contactId ? all.filter((p) => p.contact_id === contactId) : [];
      setProposals(forContact.length > 0 ? forContact : all);
    }).catch(() => setProposals([]));
  }, [contactId]);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function toggleService(service) {
    setForm((prev) => ({
      ...prev,
      services: prev.services.includes(service)
        ? prev.services.filter((s) => s !== service)
        : [...prev.services, service],
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) {
      setError("Title is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saved = await saveOpportunity({
        ...form,
        id: initial?.id ?? undefined,
        contactId: contactId ?? initial?.contact_id ?? undefined,
        value: form.value === "" ? 0 : Number(form.value),
      });
      onSave(saved);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-3 rounded-md border border-line bg-mist p-4">
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">Title <span className="text-rose-500">*</span></label>
        <input
          type="text"
          value={form.title}
          onChange={(e) => update("title", e.target.value)}
          placeholder="e.g. Follow-on AI Foundations programme"
          className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-brand"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">Description</label>
        <textarea
          value={form.description}
          onChange={(e) => update("description", e.target.value)}
          rows={2}
          placeholder="How did this arise, what's the context?"
          className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-brand resize-none"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Value (£)</label>
          <input
            type="number"
            min="0"
            value={form.value}
            onChange={(e) => update("value", e.target.value)}
            placeholder="0"
            className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Stage</label>
          <select
            value={form.stage}
            onChange={(e) => update("stage", e.target.value)}
            className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-brand"
          >
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">Close date</label>
        <input
          type="date"
          value={form.closeDate}
          onChange={(e) => update("closeDate", e.target.value)}
          className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-brand"
        />
      </div>
      {proposals.length > 0 && (
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Linked Proposal</label>
          <select
            value={form.proposalId ?? ""}
            onChange={(e) => update("proposalId", e.target.value || null)}
            className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-brand"
          >
            <option value="">None</option>
            {proposals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.proposal_code ? `${p.proposal_code} · ${p.program_title}` : p.program_title}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">Services in scope</label>
        <div className="flex flex-wrap gap-1.5">
          {SERVICE_OPTIONS.map((service) => {
            const active = form.services.includes(service);
            return (
              <button
                key={service}
                type="button"
                onClick={() => toggleService(service)}
                className={`rounded border px-2 py-0.5 text-xs font-medium transition ${
                  active
                    ? "border-brand bg-brand text-white"
                    : "border-line bg-white text-slate-600 hover:border-slate-400"
                }`}
              >
                {service}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">Notes</label>
        <textarea
          value={form.notes}
          onChange={(e) => update("notes", e.target.value)}
          rows={2}
          placeholder="Ongoing notes (distinct from description)"
          className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-brand resize-none"
        />
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-brand px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:bg-brandHover disabled:opacity-50"
        >
          {saving ? "Saving…" : (initial ? "Update" : "Create")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-line px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function ContactOpportunitiesPanel({ contact, onOppChange }) {
  const [opportunities, setOpportunities] = useState(null); // null = loading
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [updatingStage, setUpdatingStage] = useState(null);

  function load() {
    if (!isSupabaseMode()) {
      setOpportunities([]);
      return;
    }
    setOpportunities(null);
    loadContactOpportunities(contact.id)
      .then(setOpportunities)
      .catch((err) => {
        console.error(err);
        setOpportunities([]);
      });
  }

  useEffect(() => { load(); }, [contact.id]);

  function handleCreated(opp) {
    setOpportunities((prev) => [opp, ...(prev ?? [])]);
    setShowForm(false);
    onOppChange?.();
  }

  function handleUpdated(opp) {
    setOpportunities((prev) => (prev ?? []).map((o) => (o.id === opp.id ? opp : o)));
    setEditingId(null);
    onOppChange?.();
  }

  async function handleStageChange(oppId, newStage) {
    setUpdatingStage(oppId);
    try {
      await updateOpportunityStage(oppId, newStage);
      setOpportunities((prev) =>
        (prev ?? []).map((o) => (o.id === oppId ? { ...o, stage: newStage } : o))
      );
      onOppChange?.();
    } catch (err) {
      console.error(err);
    } finally {
      setUpdatingStage(null);
    }
  }

  async function handleDelete(oppId) {
    try {
      await deleteOpportunity(oppId);
      setOpportunities((prev) => (prev ?? []).filter((o) => o.id !== oppId));
      onOppChange?.();
    } catch (err) {
      console.error(err);
    } finally {
      setConfirmDeleteId(null);
    }
  }

  const isTerminal = (stage) => stage === "Won" || stage === "Lost";

  return (
    <div className="border border-line bg-white p-5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Opportunities
        </div>
        {!showForm && isSupabaseMode() && (
          <button
            type="button"
            onClick={() => { setShowForm(true); setEditingId(null); }}
            className="text-xs text-brand hover:underline"
          >
            New Opportunity
          </button>
        )}
      </div>

      {showForm && (
        <OpportunityForm
          contactId={contact.id}
          onSave={handleCreated}
          onCancel={() => setShowForm(false)}
        />
      )}

      {opportunities === null && (
        <div className="mt-3 text-xs text-slate-400">Loading…</div>
      )}

      {opportunities !== null && opportunities.length === 0 && !showForm && (
        <div className="mt-3 space-y-2">
          <p className="text-xs italic text-slate-400">No opportunities yet. Add the first one.</p>
          {isSupabaseMode() && (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="inline-flex items-center rounded border border-line px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              + New Opportunity
            </button>
          )}
        </div>
      )}

      {opportunities !== null && opportunities.length > 0 && (
        <div className="mt-3 space-y-3">
          {opportunities.map((opp) => (
            <div
              key={opp.id}
              className={`border-t border-line pt-3 first:border-t-0 first:pt-0 ${isTerminal(opp.stage) ? "opacity-60" : ""}`}
            >
              {editingId === opp.id ? (
                <OpportunityForm
                  initial={{
                    id: opp.id,
                    title: opp.title,
                    description: opp.description ?? "",
                    value: opp.value ?? "",
                    stage: opp.stage,
                    services: opp.services ?? [],
                    closeDate: opp.close_date ?? "",
                    notes: opp.notes ?? "",
                    contact_id: opp.contact_id,
                    proposalId: opp.proposal_id ?? null,
                  }}
                  contactId={contact.id}
                  onSave={handleUpdated}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => { setEditingId(opp.id); setShowForm(false); }}
                      className="text-sm font-medium text-ink leading-snug text-left hover:underline"
                    >
                      {opp.title}
                    </button>
                    <StageBadge stage={opp.stage} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-xs font-medium text-slate-600">
                      {Number(opp.value) > 0 ? formatCurrency(opp.value) : "£-"}
                    </span>
                    <span className="text-xs text-slate-400">
                      {opp.close_date
                        ? new Date(opp.close_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                        : "No date set"}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      value={opp.stage}
                      onChange={(e) => handleStageChange(opp.id, e.target.value)}
                      disabled={updatingStage === opp.id}
                      className="rounded border border-line bg-white px-2 py-0.5 text-xs text-slate-600 focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-50"
                    >
                      {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {confirmDeleteId === opp.id ? (
                      <span className="flex items-center gap-1">
                        <span className="text-xs text-slate-500">Delete?</span>
                        <button
                          type="button"
                          onClick={() => handleDelete(opp.id)}
                          className="text-xs font-medium text-rose-600 hover:underline"
                        >
                          Yes
                        </button>
                        <span className="text-xs text-slate-400">/</span>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-xs text-slate-500 hover:underline"
                        >
                          No
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(opp.id)}
                        className="text-xs text-slate-400 hover:text-rose-500"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── OpportunitiesTab ─────────────────────────────────────────────────────────

function OpportunitiesTab({ contacts, onOpenContact }) {
  const [opportunities, setOpportunities] = useState(null);
  const [stageFilter, setStageFilter] = useState("");
  const [showTerminal, setShowTerminal] = useState(false);
  const [sortCol, setSortCol] = useState("value");
  const [sortDir, setSortDir] = useState("desc");
  const [editingOpp, setEditingOpp] = useState(null); // null = not editing, obj = editing

  function load() {
    if (!isSupabaseMode()) {
      setOpportunities([]);
      return;
    }
    setOpportunities(null);
    loadAllOpportunities()
      .then(setOpportunities)
      .catch((err) => {
        console.error(err);
        setOpportunities([]);
      });
  }

  useEffect(() => { load(); }, []);

  const isTerminal = (stage) => stage === "Won" || stage === "Lost";

  function handleSort(col) {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir(col === "value" ? "desc" : "asc");
    }
  }

  function sortValue(opp, col) {
    if (col === "company") return (opp.contacts?.company ?? "").toLowerCase();
    if (col === "contact") return (opp.contacts?.contact_name ?? "").toLowerCase();
    if (col === "title") return (opp.title ?? "").toLowerCase();
    if (col === "value") return Number(opp.value) || 0;
    if (col === "stage") return STAGES.indexOf(opp.stage);
    if (col === "close_date") return opp.close_date ?? "9999-99-99";
    return "";
  }

  const visible = (opportunities ?? [])
    .filter((opp) => {
      if (!showTerminal && isTerminal(opp.stage)) return false;
      if (stageFilter && opp.stage !== stageFilter) return false;
      return true;
    })
    .slice()
    .sort((a, b) => {
      const av = sortValue(a, sortCol);
      const bv = sortValue(b, sortCol);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });

  const activeOpportunities = (opportunities ?? []).filter((opp) => !isTerminal(opp.stage));
  const totalPipelineValue = activeOpportunities.reduce((sum, opp) => sum + (Number(opp.value) || 0), 0);

  function handleUpdated(saved) {
    setOpportunities((prev) => (prev ?? []).map((o) => (o.id === saved.id ? saved : o)));
    setEditingOpp(null);
  }

  function handleRowClick(opp) {
    if (!opp.contact_id) return;
    const contact = contacts.find((c) => c.id === opp.contact_id);
    if (contact && onOpenContact) onOpenContact(contact);
  }

  return (
    <div>
      {/* Pipeline value hero */}
      <div className="mb-6 border border-line bg-white p-5 shadow-panel sm:p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Active Pipeline</div>
        <div className="mt-2 font-display text-4xl font-normal tracking-[0.02em] text-brand">
          {formatCurrency(totalPipelineValue)}
        </div>
        <div className="mt-1 text-xs text-slate-400">
          {activeOpportunities.length} active {activeOpportunities.length === 1 ? "opportunity" : "opportunities"}
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="rounded-md border border-line bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-brand"
        >
          <option value="">All stages</option>
          {STAGES.filter((s) => !isTerminal(s)).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={showTerminal}
            onChange={(e) => setShowTerminal(e.target.checked)}
            className="rounded border-line"
          />
          Show Won / Lost
        </label>
        <button
          type="button"
          onClick={load}
          className="ml-auto rounded-md border border-line px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      {/* Inline edit form */}
      {editingOpp && (
        <div className="mb-4">
          <div className="mb-2 text-xs font-semibold text-slate-500 uppercase tracking-[0.14em]">
            Editing: {editingOpp.title}
          </div>
          <OpportunityForm
            initial={{
              id: editingOpp.id,
              title: editingOpp.title,
              description: editingOpp.description ?? "",
              value: editingOpp.value ?? "",
              stage: editingOpp.stage,
              services: editingOpp.services ?? [],
              closeDate: editingOpp.close_date ?? "",
              notes: editingOpp.notes ?? "",
              contact_id: editingOpp.contact_id,
              proposalId: editingOpp.proposal_id ?? null,
            }}
            onSave={handleUpdated}
            onCancel={() => setEditingOpp(null)}
          />
        </div>
      )}

      {/* Table */}
      <div className="border border-line bg-white shadow-panel">
        {opportunities === null && (
          <div className="px-6 py-10 text-sm text-slate-400">Loading…</div>
        )}

        {opportunities !== null && visible.length === 0 && (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-slate-400 italic">
              {(opportunities ?? []).length === 0
                ? "No active opportunities. Add one from a contact record."
                : "No opportunities match the current filters."}
            </p>
          </div>
        )}

        {opportunities !== null && visible.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-mist text-left">
                  {[
                    { col: "company", label: "Company", align: "left" },
                    { col: "contact", label: "Contact", align: "left" },
                    { col: "title", label: "Opportunity", align: "left" },
                    { col: "value", label: "Value", align: "right" },
                    { col: "stage", label: "Stage", align: "left" },
                    { col: "close_date", label: "Close date", align: "left" },
                  ].map(({ col, label, align }) => (
                    <th
                      key={col}
                      className={`px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 cursor-pointer select-none hover:text-ink ${align === "right" ? "text-right" : ""}`}
                      onClick={() => handleSort(col)}
                    >
                      {label}{" "}
                      <span className="text-slate-400">
                        {sortCol === col ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
                      </span>
                    </th>
                  ))}
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {visible.map((opp) => {
                  const terminal = isTerminal(opp.stage);
                  return (
                    <tr
                      key={opp.id}
                      onClick={() => handleRowClick(opp)}
                      className={`border-b border-line last:border-b-0 transition-colors ${
                        opp.contact_id ? "cursor-pointer hover:bg-mist" : ""
                      } ${terminal ? "opacity-50" : ""}`}
                    >
                      <td className="px-4 py-3 text-ink font-medium">
                        {opp.contacts?.company || "-"}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {opp.contacts?.contact_name || "-"}
                      </td>
                      <td className="px-4 py-3 text-ink">
                        {opp.title}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-ink tabular-nums">
                        {Number(opp.value) > 0 ? formatCurrency(opp.value) : "-"}
                      </td>
                      <td className="px-4 py-3">
                        <StageBadge stage={opp.stage} />
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs">
                        {opp.close_date
                          ? new Date(opp.close_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                          : "-"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setEditingOpp(opp); }}
                          className="rounded border border-line px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ContactResearchIntelPanel ────────────────────────────────────────────────

function ContactResearchIntelPanel({ contact, onResearchSaved }) {
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(contact.researchNotes ?? "");
  const [source, setSource] = useState(contact.researchSource ?? "");
  const [updatedBy, setUpdatedBy] = useState(contact.researchUpdatedBy || "Sol");
  const [saving, setSaving] = useState(false);

  // Reset local state when the contact changes (e.g. user opens a different record)
  useEffect(() => {
    setNotes(contact.researchNotes ?? "");
    setSource(contact.researchSource ?? "");
    setUpdatedBy(contact.researchUpdatedBy || "Sol");
    setEditing(false);
  }, [contact.id]);

  const hasContent = Boolean(notes || source || contact.researchUpdatedAt);

  async function handleSave() {
    setSaving(true);
    try {
      await saveContactResearch(contact.id, { notes, source, updatedBy });
      const now = new Date().toISOString();
      if (onResearchSaved) {
        onResearchSaved({
          researchNotes: notes,
          researchSource: source,
          researchUpdatedBy: updatedBy,
          researchUpdatedAt: now,
        });
      }
      setEditing(false);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setNotes(contact.researchNotes ?? "");
    setSource(contact.researchSource ?? "");
    setUpdatedBy(contact.researchUpdatedBy || "Sol");
    setEditing(false);
  }

  return (
    <div className="border border-line bg-white p-5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Research &amp; Intel
        </div>
        {!editing && isSupabaseMode() && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-brand hover:underline"
          >
            {hasContent ? "Edit" : "Add"}
          </button>
        )}
      </div>

      {!editing && !hasContent && (
        <div className="mt-3 text-xs italic text-slate-400">No research intel recorded yet.</div>
      )}

      {!editing && hasContent && (
        <div className="mt-3 space-y-2">
          {notes && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{notes}</p>
          )}
          {(source || contact.researchUpdatedAt) && (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
              {source && <span>Source: {source}</span>}
              {contact.researchUpdatedBy && contact.researchUpdatedAt && (
                <span>
                  Updated by {contact.researchUpdatedBy} &middot;{" "}
                  {new Date(contact.researchUpdatedAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {editing && (
        <div className="mt-3 space-y-3">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Company background, key people, relevant news, AI readiness signals…"
            rows={6}
            className="w-full resize-y rounded border border-line bg-white px-3 py-2 text-sm text-ink placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand"
          />
          <input
            type="text"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="Source (e.g. Sol call prep, 9 Apr 2026)"
            className="w-full rounded border border-line bg-white px-3 py-2 text-sm text-ink placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand"
          />
          <input
            type="text"
            value={updatedBy}
            onChange={(e) => setUpdatedBy(e.target.value)}
            placeholder="Updated by (e.g. Sol)"
            className="w-full rounded border border-line bg-white px-3 py-2 text-sm text-ink placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center rounded border border-brand bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brandHover disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              className="inline-flex items-center rounded border border-line px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ProposalsTab ─────────────────────────────────────────────────────────────

function ProposalsTab({ contacts }) {
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingProposal, setEditingProposal] = useState(undefined); // undefined=closed, null=new, obj=edit
  const [accessProposal, setAccessProposal] = useState(null);
  const [copied, setCopied] = useState(null);
  const [sendingProposal, setSendingProposal] = useState(null); // proposal id being sent

  const VIEWER_URL = "https://proposals.diagonalthinking.co/view";

  async function refresh() {
    setLoading(true);
    try {
      const data = await loadProposals();
      setProposals(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function handleDelete(p) {
    if (!confirm(`Delete proposal "${p.program_title}"? This cannot be undone.`)) return;
    await deleteProposal(p.id);
    refresh();
  }

  function copyLink(p) {
    const text = `${VIEWER_URL}?code=${encodeURIComponent(p.proposal_code)}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(p.id);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  async function handleSendProposal(p) {
    if (!p.contacts?.email) {
      alert("No email address on the linked contact. Link this proposal to a contact with an email first.");
      return;
    }
    if (!confirm(`Send "${p.program_title}" to ${p.contacts.email}?`)) return;
    setSendingProposal(p.id);
    try {
      const res = await fetch("/api/send-proposal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId: p.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed");
      await refresh();
      alert(`Proposal sent to ${data.to}`);
    } catch (err) {
      alert(`Send failed: ${err.message}`);
    } finally {
      setSendingProposal(null);
    }
  }

  return (
    <div>
      {/* Proposals header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-normal uppercase tracking-[0.02em] text-ink">PROPOSALS</h2>
          <p className="mt-1 text-sm text-slate-500">
            {isSupabaseMode() ? `${proposals.length} proposal${proposals.length !== 1 ? "s" : ""}` : "Connect to Supabase to manage proposals"}
          </p>
        </div>
        {isSupabaseMode() && (
          <button
            type="button"
            onClick={() => setEditingProposal(null)}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90"
          >
            <Plus size={16} /> New Proposal
          </button>
        )}
      </div>

      {!isSupabaseMode() && (
        <div className="border border-line bg-slate-50 px-5 py-8 text-center text-sm text-slate-400">
          Proposals are stored in Supabase. Run the app in Supabase mode to manage proposals.
        </div>
      )}

      {isSupabaseMode() && loading && (
        <div className="py-10 text-center text-sm text-slate-400">Loading proposals…</div>
      )}

      {isSupabaseMode() && !loading && proposals.length === 0 && (
        <div className="border border-line bg-slate-50 px-5 py-10 text-center text-sm text-slate-400">
          No proposals yet. Create your first one.
        </div>
      )}

      {isSupabaseMode() && !loading && proposals.length > 0 && (
        <div className="border border-line bg-white">
          {/* Desktop table - hidden on small screens */}
          <div className="hidden sm:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3">Program</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{p.program_title}</div>
                      {p.subtitle && <div className="text-xs text-slate-400">{p.subtitle}</div>}
                    </td>
                    <td className="px-4 py-3">
                      {p.contacts ? (
                        <div>
                          <div className="text-ink">{p.contacts.contact_name}</div>
                          <div className="text-xs text-slate-400">{p.contacts.company}</div>
                        </div>
                      ) : (
                        <span className="text-slate-300 italic">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <code className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-brand">{p.proposal_code}</code>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{p.date}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${p.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
                        {p.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {/* Primary actions */}
                        <button
                          type="button"
                          onClick={() => setEditingProposal(p)}
                          className="text-xs font-medium text-brand hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSendProposal(p)}
                          disabled={sendingProposal === p.id}
                          className="text-xs font-medium text-emerald-600 hover:text-emerald-800 disabled:opacity-50"
                          title={p.contacts?.email ? `Send to ${p.contacts.email}` : "Link a contact with an email to enable sending"}
                        >
                          {sendingProposal === p.id ? "Sending…" : "Send"}
                        </button>
                        {/* Icon actions */}
                        <div className="flex items-center gap-0.5 border-l border-line pl-3">
                          <button
                            type="button"
                            onClick={() => copyLink(p)}
                            title={`Copy client link (code ${p.proposal_code})`}
                            className="rounded p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                          >
                            {copied === p.id ? <span className="text-[10px] font-semibold text-brand">✓</span> : <Link2 size={14} />}
                          </button>
                          <a
                            href={`/api/admin/proposal-pdf/${p.id}`}
                            download
                            title="Download proposal as PDF"
                            className="rounded p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                          >
                            <Download size={14} />
                          </a>
                          <button
                            type="button"
                            onClick={() => setAccessProposal(p)}
                            title="View access history"
                            className="rounded p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(p)}
                            title="Delete proposal"
                            className="rounded p-1.5 text-rose-400 transition hover:bg-rose-50 hover:text-rose-600"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card list - visible only on small screens */}
          <div className="space-y-0 sm:hidden">
            {proposals.map((p) => (
              <div key={p.id} className="border-b border-line p-4 last:border-b-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink leading-snug">{p.program_title}</div>
                    {p.subtitle && <div className="mt-0.5 text-xs text-slate-400">{p.subtitle}</div>}
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${p.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
                    {p.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
                {p.contacts && (
                  <div className="mt-1.5 text-sm text-slate-600">
                    {p.contacts.contact_name}
                    {p.contacts.company && <span className="text-slate-400"> · {p.contacts.company}</span>}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  <code className="rounded bg-slate-100 px-2 py-0.5 font-bold text-brand">{p.proposal_code}</code>
                  {p.date && <span>{p.date}</span>}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingProposal(p)}
                    className="min-h-[44px] rounded-md border border-line px-3 py-2 text-xs font-medium text-brand hover:bg-slate-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSendProposal(p)}
                    disabled={sendingProposal === p.id}
                    className="min-h-[44px] rounded-md border border-emerald-200 px-3 py-2 text-xs font-medium text-emerald-600 hover:text-emerald-800 disabled:opacity-50"
                    title={p.contacts?.email ? `Send to ${p.contacts.email}` : "Link a contact with an email to enable sending"}
                  >
                    {sendingProposal === p.id ? "Sending…" : "Send"}
                  </button>
                  <button
                    type="button"
                    onClick={() => copyLink(p)}
                    className="min-h-[44px] rounded-md border border-line px-3 py-2 text-xs font-medium text-slate-600 hover:text-brand"
                    title={`Copy client link for code ${p.proposal_code}`}
                  >
                    {copied === p.id ? "Copied!" : "Copy link"}
                  </button>
                  <a
                    href={`/api/admin/proposal-pdf/${p.id}`}
                    download
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-line px-3 py-2 text-xs font-medium text-slate-600 hover:text-brand"
                  >
                    <Download size={13} />
                    Download PDF
                  </a>
                  <button
                    type="button"
                    onClick={() => setAccessProposal(p)}
                    className="min-h-[44px] rounded-md border border-line px-3 py-2 text-xs font-medium text-slate-600 hover:text-brand"
                  >
                    Accesses
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(p)}
                    className="min-h-[44px] rounded-md border border-red-200 px-3 py-2 text-xs font-medium text-red-400 hover:text-red-600"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {editingProposal !== undefined && (
        <ProposalWriterForm
          proposal={editingProposal}
          contacts={contacts}
          onSave={() => { setEditingProposal(undefined); refresh(); }}
          onClose={() => setEditingProposal(undefined)}
        />
      )}

      {accessProposal && (
        <ProposalAccessPanel proposal={accessProposal} onClose={() => setAccessProposal(null)} />
      )}
    </div>
  );
}

// ─── Dedup helpers ────────────────────────────────────────────────────────────

function normalizeCompanyName(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/\b(ltd|limited|plc|llp|llc|inc|co|company|group|the)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [activeTab, setActiveTab] = useState("crm");
  const [contacts, setContacts] = useState([]);
  // CRM-012: Map<contact_id, total active opp value> - derived from opportunities table.
  // Used for pipeline stat, contact Snapshot, and contacts list sort.
  const [oppTotals, setOppTotals] = useState(new Map());
  const [syncStatus, setSyncStatus] = useState("syncing");
  const [syncError, setSyncError] = useState("");
  const initialLoadDoneRef = useRef(false);
  const skipNextSaveRef = useRef(false); // prevents redundant save immediately after DB load
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [serviceFilter, setServiceFilter] = useState("All");
  const [networkPartnerFilter, setNetworkPartnerFilter] = useState(false);
  const [sortConfig, setSortConfig] = useState({
    key: "dateAdded",
    direction: "desc",
  });
  const [activeContact, setActiveContact] = useState(null);
  const [isNewContact, setIsNewContact] = useState(false);
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);
  const [importState, setImportState] = useState(null);
  const [importSummary, setImportSummary] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [clientAreaLaunchContact, setClientAreaLaunchContact] = useState(null);
  const [companyToast, setCompanyToast] = useState(null);
  const companyToastTimerRef = useRef(null);
  const [mailchimpSyncing, setMailchimpSyncing] = useState(false);
  const [mailchimpToast, setMailchimpToast] = useState(null);
  const mailchimpToastTimerRef = useRef(null);
  const importFileRef = useRef(null);
  const dataLoadRef = useRef(null);
  const contactsListRef = useRef(null);

  function navigateToFilter(type) {
    setTypeFilter(type);
    setTimeout(() => {
      contactsListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  // Save contacts whenever they change (but not during initial load)
  useEffect(() => {
    if (!initialLoadDoneRef.current) return;
    // Skip the save that fires immediately after loading from DB (nothing has changed)
    if (skipNextSaveRef.current) { skipNextSaveRef.current = false; return; }
    setSyncStatus("syncing");
    saveAllContacts(contacts)
      .then(() => setSyncStatus("synced"))
      .catch((err) => { setSyncError(err?.message || "Unknown sync error"); setSyncStatus("error"); });
  }, [contacts]);

  // Load contacts on mount
  useEffect(() => {
    loadContacts()
      .then((data) => {
        if (Array.isArray(data)) {
          skipNextSaveRef.current = true; // don't re-save what we just loaded
          setContacts(data.map(createContactRecord));
          setSyncStatus("synced");
        }
        initialLoadDoneRef.current = true;
      })
      .catch((err) => {
        setSyncError(err?.message || "Could not load contacts");
        setSyncStatus("error");
        initialLoadDoneRef.current = true;
      });
  }, []);

  // CRM-012: Load opportunity totals on mount and expose a refresh function.
  // Called after any opportunity create/edit/delete/stage-change.
  function refreshOppTotals() {
    loadContactOpportunityTotals()
      .then(setOppTotals)
      .catch((err) => console.error("Failed to load opportunity totals:", err));
  }
  useEffect(() => { refreshOppTotals(); }, []);

  const uniqueCompanyNames = useMemo(
    () =>
      [...new Set(contacts.map((c) => c.company).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [contacts],
  );

  const filteredContacts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const result = contacts.filter((contact) => {
      const matchesSearch =
        !query ||
        [contact.company, contact.contactName, contact.email]
          .join(" ")
          .toLowerCase()
          .includes(query);
      const matchesType = typeFilter === "All" || contact.type === typeFilter;
      const matchesPartner = !networkPartnerFilter || contact.networkPartner === true;
      const matchesService =
        serviceFilter === "All" || contact.services.includes(serviceFilter);
      return matchesSearch && matchesType && matchesService && matchesPartner;
    });

    result.sort((left, right) => {
      const direction = sortConfig.direction === "asc" ? 1 : -1;

      // CRM-012: sort by derived opp total, not manual projected_value
      if (sortConfig.key === "projectedValue") {
        return ((oppTotals.get(left.id) ?? 0) - (oppTotals.get(right.id) ?? 0)) * direction;
      }

      const a = left[sortConfig.key];
      const b = right[sortConfig.key];

      if (sortConfig.key === "totalClientValue" || sortConfig.key === "liveWorkValue") {
        return (Number(a) - Number(b)) * direction;
      }

      return String(a).localeCompare(String(b)) * direction;
    });

    return result;
  }, [contacts, search, typeFilter, serviceFilter, sortConfig, networkPartnerFilter, oppTotals]);

  const stats = useMemo(() => {
    const counts = TYPE_OPTIONS.reduce(
      (accumulator, type) => ({
        ...accumulator,
        [type]: contacts.filter((contact) => contact.type === type).length,
      }),
      {},
    );

    // CRM-012: Projected Pipeline - sum of all active opportunity values across all contacts.
    // "Active" = non-Won, non-Lost. No company-level deduplication (each opp counts individually).
    const projected = Array.from(oppTotals.values()).reduce((sum, val) => sum + val, 0);
    const warmLeadValue = projected;

    const networkPartnerCount = contacts.filter((c) => c.networkPartner).length;

    return {
      counts,
      projected,
      warmLeadValue,
      networkPartnerCount,
      recent: [...contacts]
        .sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded))
        .slice(0, 5),
      chart: TYPE_OPTIONS.map((type) => ({
        name: type,
        value: counts[type],
        color: TYPE_COLORS[type],
      })),
    };
  }, [contacts, oppTotals]);

  // Dedup: find another contact with the same email or normalised company name
  const potentialDuplicate = useMemo(() => {
    if (!activeContact || isNewContact) return null;
    const email = activeContact.email?.trim().toLowerCase();
    const company = normalizeCompanyName(activeContact.company);
    return (
      contacts.find((c) => {
        if (c.id === activeContact.id) return false;
        if (email && c.email?.trim().toLowerCase() === email) return true;
        if (company && normalizeCompanyName(c.company) === company) return true;
        return false;
      }) ?? null
    );
  }, [contacts, activeContact, isNewContact]);


  function openNewContact() {
    setIsNewContact(true);
    setActiveContact(createContactRecord(emptyContact()));
  }

  function openExistingContact(contact) {
    setIsNewContact(false);
    setActiveContact({ ...contact, services: [...contact.services] });
  }

  function updateActiveContact(field, value) {
    setActiveContact((current) => ({
      ...current,
      [field]: value,
      lastUpdated: todayStamp(),
    }));
  }

  function toggleActiveService(service) {
    setActiveContact((current) => {
      const services = current.services.includes(service)
        ? current.services.filter((item) => item !== service)
        : [...current.services, service];

      return {
        ...current,
        services,
        lastUpdated: todayStamp(),
      };
    });
  }

  function toggleActivePlatform(platform) {
    setActiveContact((current) => {
      const platforms = current.platforms.includes(platform)
        ? current.platforms.filter((item) => item !== platform)
        : [...current.platforms, platform];

      return {
        ...current,
        platforms,
        lastUpdated: todayStamp(),
      };
    });
  }

  function saveActiveContact() {
    if (!activeContact) return;

    const nextRecord = createContactRecord({
      ...activeContact,
      dateAdded: isNewContact ? todayStamp() : activeContact.dateAdded,
      lastUpdated: todayStamp(),
    });

    // Find services that were just added (not in old record, now in new)
    const oldServices = isNewContact
      ? []
      : (contacts.find((c) => c.id === nextRecord.id)?.services ?? []);
    const addedServices = nextRecord.services.filter(
      (s) => !oldServices.includes(s),
    );

    // Propagate newly added services to all other contacts at the same company
    const companyName = nextRecord.company?.trim();
    let updatedCount = 0;

    // Immediately persist the primary contact to Supabase.
    // This direct upsert is the reliable save path, it does not depend on the
    // batch saveAllContacts effect and cannot be blocked by URL-size issues or
    // race conditions in the bulk-sync flow.
    if (isSupabaseMode()) {
      upsertContact(nextRecord).catch((err) => {
        if (err?.isDuplicateEmail) {
          // Silent merge path handled a Squarespace-webhook row. If we still
          // surface 23505 here, another contact genuinely owns this email.
          setCompanyToast("A contact with this email already exists.");
          if (companyToastTimerRef.current) clearTimeout(companyToastTimerRef.current);
          companyToastTimerRef.current = setTimeout(() => setCompanyToast(null), 4000);
          console.warn("Duplicate email on contact save", err);
          return;
        }
        console.error("Contact save failed", err);
        setSyncError(err?.message || "Contact save failed");
        setSyncStatus("error");
      });
    }

    setContacts((current) => {
      const updated = current.map((contact) => {
        // Skip the contact being saved, skip blank companies, skip non-matching companies
        if (
          contact.id === nextRecord.id ||
          !companyName ||
          contact.company?.trim().toLowerCase() !== companyName.toLowerCase()
        ) {
          return contact.id === nextRecord.id ? nextRecord : contact;
        }

        // Add any newly added services this contact doesn't already have
        const missingServices = addedServices.filter(
          (s) => !contact.services.includes(s),
        );
        if (missingServices.length === 0) return contact;

        updatedCount += 1;
        return createContactRecord({
          ...contact,
          services: [...contact.services, ...missingServices],
          lastUpdated: todayStamp(),
        });
      });

      if (isNewContact) return [nextRecord, ...updated];
      return updated;
    });

    // Show toast if any company-mates were updated
    if (addedServices.length > 0 && companyName && updatedCount > 0) {
      const serviceLabel =
        addedServices.length === 1
          ? `"${addedServices[0]}"`
          : `${addedServices.length} services`;
      const msg = `Applied ${serviceLabel} to ${updatedCount} other contact${updatedCount === 1 ? "" : "s"} at ${companyName}`;
      setCompanyToast(msg);
      if (companyToastTimerRef.current) clearTimeout(companyToastTimerRef.current);
      companyToastTimerRef.current = setTimeout(() => setCompanyToast(null), 4000);
    }

    // Background Mailchimp sync for the saved contact (fire-and-forget)
    if (nextRecord.email) {
      const parts = (nextRecord.contactName || "").trim().split(/\s+/);
      const mcPayload = {
        id: nextRecord.id,
        email: nextRecord.email,
        fname: parts[0] || "",
        lname: parts.slice(1).join(" ") || "",
        company: nextRecord.company || "",
        pipeline: nextRecord.type || "",
        type: nextRecord.type || "",
        source: nextRecord.source || "",
        network_partner: nextRecord.networkPartner ?? false,
        services: Array.isArray(nextRecord.services)
          ? nextRecord.services
          : nextRecord.services || "",
      };
      fetch("/api/mailchimp-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacts: [mcPayload] }),
      }).catch((err) => console.error("[Mailchimp bg sync]", err));
    }

    setActiveContact(null);
    setIsNewContact(false);
  }

  async function handleDeleteConfirm(id) {
    setIsDeleting(true);
    try {
      await deleteContactApi(id);
    } catch (e) {
      console.error("Delete failed:", e);
      setIsDeleting(false);
      return;
    }
    setContacts((current) => current.filter((contact) => contact.id !== id));
    if (activeContact?.id === id) {
      setActiveContact(null);
      setIsNewContact(false);
    }
    setConfirmDeleteId(null);
    setIsDeleting(false);
  }

  async function handleMailchimpSync() {
    setMailchimpSyncing(true);

    function showMailchimpToast(msg) {
      setMailchimpToast(msg);
      if (mailchimpToastTimerRef.current) clearTimeout(mailchimpToastTimerRef.current);
      mailchimpToastTimerRef.current = setTimeout(() => setMailchimpToast(null), 6000);
    }

    try {
      const payload = contacts
        .filter((c) => c.email)
        .map((c) => {
          const parts = (c.contactName || "").trim().split(/\s+/);
          return {
            id: c.id,
            email: c.email,
            fname: parts[0] || "",
            lname: parts.slice(1).join(" ") || "",
            company: c.company || "",
            pipeline: c.type || "",
            type: c.type || "",
            source: c.source || "",
            network_partner: c.networkPartner ?? false,
            services: Array.isArray(c.services) ? c.services : (c.services || ""),
          };
        });

      const res = await fetch("/api/mailchimp-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacts: payload }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Sync failed");
      }

      // Best-effort: update last_synced_at on synced contacts in Supabase
      if (isSupabaseMode() && data.syncedIds?.length) {
        try {
          const sb = getSupabaseClient();
          const now = new Date().toISOString();
          await sb
            .from("contacts")
            .update({ last_synced_at: now })
            .in("id", data.syncedIds);
        } catch {
          // Non-fatal - column may not exist yet
        }
      }

      showMailchimpToast(
        `Mailchimp sync complete. ${data.added} added, ${data.updated} updated, ${data.skipped} skipped.`
      );
    } catch (err) {
      showMailchimpToast(`Mailchimp sync failed: ${err.message}`);
    } finally {
      setMailchimpSyncing(false);
    }
  }

  function requestSort(key) {
    setSortConfig((current) => ({
      key,
      direction:
        current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  function triggerImport(mode) {
    if (mode === "general") {
      importFileRef.current?.click();
      return;
    }
    dataLoadRef.current?.click();
  }

  function handleImportFile(file, sourceLabel) {
    if (!file) return;
    const reader = new FileReader();

    reader.onload = async (event) => {
      const buffer = event.target?.result;
      if (!buffer) return;

      let rows = [];
      if (file.name.toLowerCase().endsWith(".csv")) {
        const parsed = Papa.parse(buffer, {
          header: true,
          skipEmptyLines: true,
        });
        rows = parsed.data;
      } else {
        const XLSX = await loadXlsx();
        const workbook = XLSX.read(buffer, { type: "array" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
      }

      const headers = Object.keys(rows[0] || {});
      const mapping = inferMapping(headers);
      const missingExpectedHeaders = expectedInitialHeaders.filter(
        (header) => !headers.includes(header),
      );

      setImportState({
        sourceLabel,
        fileName: file.name,
        rows,
        headers,
        mapping,
        preview: null,
        applied: false,
        missingExpectedHeaders,
      });
    };

    if (file.name.toLowerCase().endsWith(".csv")) {
      reader.readAsText(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
  }

  function buildImportPreview() {
    if (!importState) return;

    const prepared = importState.rows
      .map((row) => parseImportedRecord(row, importState.mapping))
      .filter(
        (record) =>
          record.company || record.contactName || record.email || record.phone,
      );

    const duplicates = [];
    const fresh = [];

    prepared.forEach((record, index) => {
      const duplicate = findDuplicate(contacts, record);
      if (duplicate) {
        duplicates.push({
          importId: `${record.id}-${index}`,
          existing: duplicate,
          incoming: record,
          action: "merge",
        });
      } else {
        fresh.push(record);
      }
    });

    setImportState((current) => ({
      ...current,
      preview: {
        fresh,
        duplicates,
        totalPrepared: prepared.length,
      },
    }));
  }

  function applyImport() {
    if (!importState?.preview) return;

    const nextContacts = [...contacts];
    const syncBatch = [];
    let imported = 0;
    let merged = 0;
    let replaced = 0;
    let skipped = 0;

    importState.preview.fresh.forEach((record) => {
      const r = createContactRecord(record);
      nextContacts.unshift(r);
      syncBatch.push(r);
      imported += 1;
    });

    importState.preview.duplicates.forEach((item) => {
      const targetIndex = nextContacts.findIndex(
        (record) => record.id === item.existing.id,
      );
      if (targetIndex === -1) return;

      if (item.action === "skip") {
        skipped += 1;
        return;
      }

      if (item.action === "replace") {
        nextContacts[targetIndex] = createContactRecord({
          ...item.incoming,
          id: item.existing.id,
          dateAdded: item.existing.dateAdded,
          lastUpdated: todayStamp(),
        });
        syncBatch.push(nextContacts[targetIndex]);
        replaced += 1;
        return;
      }

      nextContacts[targetIndex] = mergeContacts(item.existing, item.incoming);
      syncBatch.push(nextContacts[targetIndex]);
      merged += 1;
    });

    setContacts(nextContacts);
    setImportSummary({
      imported,
      merged,
      replaced,
      skipped,
      sourceLabel: importState.sourceLabel,
      fileName: importState.fileName,
    });
    setImportState(null);
  }

  async function exportData(format) {
    const rows = exportRows(filteredContacts);
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `Diagonal Thinking CRM - ${stamp}.${format}`;

    if (format === "csv") {
      const csv = Papa.unparse(rows);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      return;
    }

    const XLSX = await loadXlsx();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "CRM");
    XLSX.writeFile(workbook, filename);
  }

  return (
    <div className="min-h-screen bg-transparent">
      <div className="mx-auto max-w-7xl px-0 py-0 sm:px-4 sm:py-6 lg:px-8">
        <header className="overflow-hidden rounded-none border-y border-line bg-white shadow-panel sm:rounded-xl sm:border sm:border-line">
          {/* Top brand bar */}
          <div className="border-b border-brand bg-brand px-5 py-3 sm:px-6">
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 items-center">
                <img
                  src="/brand/logo-full-white.png"
                  alt="Diagonal Thinking"
                  className="h-8 w-auto sm:h-10"
                />
              </div>
              <div className="flex items-center gap-3">
                <SyncDot status={syncStatus} />
                {isSupabaseMode() && (
                  <button
                    type="button"
                    onClick={signOut}
                    className="text-xs text-white/55 transition hover:text-white"
                    title="Sign out"
                  >
                    Sign out
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Tab nav */}
          <div className="border-b border-line bg-white px-4 sm:px-6">
            <div className="-mx-1 flex gap-1 overflow-x-auto py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {[
                { key: "crm", label: "CRM" },
                { key: "opportunities", label: "Opportunities" },
                { key: "proposals", label: "Proposals" },
                { key: "client-area", label: "Client Area" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`shrink-0 rounded-md px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] transition-colors ${
                    activeTab === tab.key
                      ? "bg-brand text-white"
                      : "text-slate-400 hover:bg-mist hover:text-slate-600"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Blue hero section - CRM tab only */}
          {activeTab === "crm" && (<>
          <div className="bg-brand px-5 py-6 text-white sm:px-6 sm:py-9">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="font-display text-3xl font-normal uppercase tracking-[0.02em] leading-none text-balance sm:text-5xl">
                  DIAGONAL THINKING CRM
                </h1>
              </div>
              <div className="border-t-[3px] border-t-brand border-x border-b border-line bg-white px-4 py-3 sm:shrink-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink">
                  Pipeline Summary
                </div>
                <div className="mt-1 font-display text-[28px] font-normal leading-none tracking-[0.02em] tabular-nums text-brand">
                  {stats.counts["Warm Lead"]} Warm Leads
                </div>
                <div className="mt-1 text-sm tabular-nums text-slate-500">
                  {formatCurrency(stats.warmLeadValue)} projected
                </div>
              </div>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 gap-0 divide-x divide-y divide-line border-t border-line bg-white sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
            <SummaryCard label="Total Contacts" value={contacts.length} onClick={() => navigateToFilter("All")} />
            <SummaryCard label="Clients" value={stats.counts.Client} onClick={() => navigateToFilter("Client")} />
            <SummaryCard label="Warm Leads" value={stats.counts["Warm Lead"]} onClick={() => navigateToFilter("Warm Lead")} />
            <SummaryCard label="Cold Leads" value={stats.counts["Cold Lead"]} onClick={() => navigateToFilter("Cold Lead")} />
            <SummaryCard
              label="Network Partners"
              value={stats.networkPartnerCount}
              onClick={() => { setNetworkPartnerFilter(true); setTimeout(() => contactsListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }}
            />
            <SummaryCard
              label="Projected Pipeline"
              value={formatCurrency(stats.projected)}
              className="col-span-2 sm:col-span-3 lg:col-span-1"
            />
          </div>
          </>)}
        </header>

        {activeTab === "opportunities" && (
          <div className="mt-6">
            <OpportunitiesTab
              contacts={contacts}
              onOpenContact={(contact) => {
                setActiveContact(contact);
                setIsNewContact(false);
                setActiveTab("crm");
              }}
            />
          </div>
        )}

        {activeTab === "proposals" && (
          <div className="mt-6">
            <ProposalsTab contacts={contacts} />
          </div>
        )}

        {activeTab === "client-area" && (
          <ClientAreaTab
            contacts={contacts}
            launchContact={clientAreaLaunchContact}
            onLaunchConsumed={() => setClientAreaLaunchContact(null)}
          />
        )}

        {activeTab === "crm" && syncStatus === "error" && (
          <div className="mt-6 border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
            <span className="font-semibold">Could not sync with the database.</span>{" "}
            Check your connection and try refreshing.
          </div>
        )}

        {activeTab === "crm" && importSummary ? (
          <div className="mt-6 border border-brand bg-brandSoft px-5 py-4 text-sm text-ink">
            Imported from <span className="font-semibold">{importSummary.fileName}</span>:
            {" "}
            {importSummary.imported} new, {importSummary.merged} merged,
            {" "}
            {importSummary.replaced} replaced, {importSummary.skipped} skipped.
          </div>
        ) : null}

        {activeTab === "crm" && <section className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
          <div className="border border-line bg-white p-5 shadow-panel sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-2xl font-normal uppercase tracking-[0.02em] text-ink sm:text-3xl">DASHBOARD</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Live overview of pipeline health and recent additions.
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_1fr]">
              <div className="min-w-0 border border-line bg-mist p-4">
                <div className="text-sm font-medium text-slate-600">
                  Contacts by Type
                </div>
                <div className="mt-4 h-64 min-w-0">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={256}>
                    <PieChart>
                      <Pie
                        data={stats.chart}
                        innerRadius={70}
                        outerRadius={100}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {stats.chart.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {stats.chart.map((entry) => (
                    <div key={entry.name} className="flex items-center justify-between border border-line bg-white px-3 py-2">
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: entry.color }}
                        />
                        {entry.name}
                      </div>
                      <div className="text-sm font-semibold text-ink">{entry.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div className="border border-line bg-white p-4">
                  <div className="text-sm font-medium text-slate-600">
                    Last 5 Contacts Added
                  </div>
                  <div className="mt-4 space-y-3">
                    {stats.recent.length ? (
                      stats.recent.map((contact) => (
                        <button
                          key={contact.id}
                          type="button"
                          onClick={() => openExistingContact(contact)}
                          className="flex w-full items-start justify-between border border-line bg-mist px-4 py-3 text-left transition hover:bg-brandSoft"
                        >
                          <div>
                            <div className="font-medium text-ink">{contact.company || "Untitled contact"}</div>
                            <div className="text-sm text-slate-500">
                              {contact.contactName || "No contact name"} · {contact.type}
                            </div>
                          </div>
                          <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
                            {formatDate(contact.dateAdded)}
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="border border-line bg-mist px-4 py-6 text-sm text-slate-500">
                        No contacts yet. Add one or import your CRM spreadsheet.
                      </div>
                    )}
                  </div>
                </div>

                <div className="border border-line bg-white p-4">
                  <div className="text-sm font-medium text-ink">Initial Data Load</div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Accepts CSV or Excel and expects the existing CRM headers you supplied.
                    You can still remap columns before import if the sheet varies.
                  </p>
                  <button
                    type="button"
                    onClick={() => triggerImport("initial")}
                    className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold uppercase tracking-[0.12em] text-white transition hover:bg-brandHover"
                  >
                    <FileSpreadsheet size={16} />
                    Load CRM data
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="border border-line bg-white p-4 shadow-panel sm:p-6">
            <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 sm:hidden">
              Quick Actions & Filters
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3">
              <ActionButton onClick={openNewContact} icon={<Plus size={16} />} className="col-span-2 sm:col-span-1">
                Add Contact
              </ActionButton>
              <ActionButton
                onClick={() => triggerImport("general")}
                icon={<Upload size={16} />}
                className="col-span-2 sm:col-span-1"
              >
                Import CSV / Excel
              </ActionButton>
              <ActionButton
                onClick={() => exportData("csv")}
                variant="secondary"
                icon={<Download size={16} />}
              >
                Export CSV
              </ActionButton>
              <ActionButton
                onClick={() => exportData("xlsx")}
                variant="secondary"
                icon={<FileSpreadsheet size={16} />}
              >
                Export Excel
              </ActionButton>
              <ActionButton
                onClick={handleMailchimpSync}
                variant="secondary"
                icon={<RefreshCw size={16} className={mailchimpSyncing ? "animate-spin" : ""} />}
                className={mailchimpSyncing ? "opacity-60 cursor-not-allowed" : ""}
              >
                {mailchimpSyncing ? "Syncing…" : "Sync to Mailchimp"}
              </ActionButton>
            </div>

            <div className="mt-5 space-y-4">
              <div className="relative">
                <Search
                  size={18}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search company, name, or email"
                  className="w-full rounded-md border border-line bg-white py-3 pl-11 pr-4 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    <Filter size={14} />
                    Type Filter
                  </div>
                  <SelectInput
                    value={typeFilter}
                    onChange={(event) => setTypeFilter(event.target.value)}
                  >
                    <option>All</option>
                    {TYPE_OPTIONS.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </SelectInput>
                </label>

                <label className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Service Filter
                  </div>
                  <SelectInput
                    value={serviceFilter}
                    onChange={(event) => setServiceFilter(event.target.value)}
                  >
                    <option>All</option>
                    {SERVICE_OPTIONS.map((service) => (
                      <option key={service}>{service}</option>
                    ))}
                  </SelectInput>
                </label>
              </div>
              <label className="flex items-center gap-2.5 cursor-pointer select-none mt-1">
                <input
                  type="checkbox"
                  checked={networkPartnerFilter}
                  onChange={(e) => setNetworkPartnerFilter(e.target.checked)}
                  className="h-4 w-4 rounded border-line accent-brand"
                />
                <span className="text-sm font-medium text-slate-700">Network Partners only</span>
              </label>
            </div>
          </div>
        </section>}

        {activeTab === "crm" && <section ref={contactsListRef} className="mt-6 border border-line bg-white shadow-panel">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 sm:px-6 sm:py-5">
            <div>
              <h2 className="font-display text-2xl font-normal uppercase tracking-[0.02em] text-ink sm:text-3xl">CONTACT LIST</h2>
              <p className="mt-1 text-sm text-slate-500">
                {filteredContacts.length} contacts in the current view.
              </p>
            </div>
          </div>

          {/* Desktop table - hidden on small screens */}
          <div className="hidden sm:block">
            <table className="w-full table-fixed text-left">
              <thead className="bg-mist text-xs uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <SortableHeader
                    active={sortConfig.key === "company"}
                    direction={sortConfig.direction}
                    onClick={() => requestSort("company")}
                    className="w-[22%]"
                  >
                    Company
                  </SortableHeader>
                  <SortableHeader
                    active={sortConfig.key === "totalClientValue"}
                    direction={sortConfig.direction}
                    onClick={() => requestSort("totalClientValue")}
                    className="w-[8%] text-right"
                  >
                    Invoiced
                  </SortableHeader>
                  <SortableHeader
                    active={sortConfig.key === "liveWorkValue"}
                    direction={sortConfig.direction}
                    onClick={() => requestSort("liveWorkValue")}
                    className="w-[8%] text-right"
                  >
                    Live work
                  </SortableHeader>
                  <SortableHeader
                    active={sortConfig.key === "projectedValue"}
                    direction={sortConfig.direction}
                    onClick={() => requestSort("projectedValue")}
                    className="w-[8%] text-right"
                  >
                    Projected
                  </SortableHeader>
                  <th className="px-4 py-4 font-semibold w-[13%]">Contact</th>
                  <SortableHeader
                    active={sortConfig.key === "type"}
                    direction={sortConfig.direction}
                    onClick={() => requestSort("type")}
                    className="w-[10%]"
                  >
                    Type
                  </SortableHeader>
                  <th className="px-4 py-4 font-semibold w-[18%]">Services</th>
                  <SortableHeader
                    active={sortConfig.key === "dateAdded"}
                    direction={sortConfig.direction}
                    onClick={() => requestSort("dateAdded")}
                    className="w-[9%]"
                  >
                    Date Added
                  </SortableHeader>
                  <th className="px-4 py-4 font-semibold w-[12%]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredContacts.length ? (
                  filteredContacts.map((contact) => (
                    <tr
                      key={contact.id}
                      className="border-t border-line transition hover:bg-mist"
                    >
                      <td className="px-4 py-3 max-w-0">
                        <button
                          type="button"
                          onClick={() => openExistingContact(contact)}
                          className="text-left w-full"
                        >
                          <div className="truncate font-semibold text-ink">{contact.company || "Untitled company"}</div>
                          <div className="truncate text-sm text-slate-500">{contact.email || "No email"}</div>
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-ink">
                        {formatCurrencyOrDash(contact.totalClientValue)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-ink">
                        {formatCurrencyOrDash(contact.liveWorkValue)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-ink">
                        {formatCurrencyOrDash(oppTotals.get(contact.id) ?? 0)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600 max-w-0">
                        <div className="truncate">{contact.contactName || "No contact name"}</div>
                        <div className="truncate text-slate-400">{contact.phone || ""}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
                              TYPE_STYLES[contact.type]?.pill || TYPE_STYLES["Warm Lead"].pill
                            }`}
                          >
                            <span
                              className={`h-2 w-2 flex-shrink-0 rounded-full ${
                                TYPE_STYLES[contact.type]?.dot || TYPE_STYLES["Warm Lead"].dot
                              }`}
                            />
                            <span className="truncate">{contact.type}</span>
                          </span>
                          {contact.networkPartner && (
                            <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 bg-amber-50 text-amber-700 ring-amber-200">
                              Partner
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {contact.services.length ? (
                          <div className="flex flex-wrap gap-1">
                            {contact.services.slice(0, 2).map((service) => (
                              <span
                                key={service}
                                className="rounded-sm border border-line bg-mist px-2 py-0.5 text-xs font-medium text-inkSoft whitespace-nowrap"
                              >
                                {service}
                              </span>
                            ))}
                            {contact.services.length > 2 && (
                              <span className="rounded-sm border border-line bg-mist px-2 py-0.5 text-xs font-medium text-slate-400 whitespace-nowrap">
                                +{contact.services.length - 2}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {formatDate(contact.dateAdded)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openExistingContact(contact)}
                            className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-brand hover:text-ink"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(contact.id)}
                            className="rounded-md border border-line p-1.5 text-rose-500 transition hover:bg-rose-50"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="9" className="px-6 py-16 text-center text-slate-500">
                      No contacts match the current search and filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile card list - visible only on small screens */}
          <div className="space-y-3 p-4 sm:hidden">
            {filteredContacts.length ? (
              filteredContacts.map((contact) => (
                <div key={contact.id} className="border border-line bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => openExistingContact(contact)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="font-semibold text-ink leading-tight">
                        {contact.company || "Untitled company"}
                      </div>
                      <div className="mt-0.5 text-sm text-slate-500 truncate">
                        {contact.email || "No email"}
                      </div>
                    </button>
                    <div className="flex flex-wrap gap-1 shrink-0">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium ring-1 ${
                          TYPE_STYLES[contact.type]?.pill || TYPE_STYLES["Warm Lead"].pill
                        }`}
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${
                            TYPE_STYLES[contact.type]?.dot || TYPE_STYLES["Warm Lead"].dot
                          }`}
                        />
                        {contact.type}
                      </span>
                      {contact.networkPartner && (
                        <span className="inline-flex items-center rounded-sm px-2.5 py-1 text-xs font-medium ring-1 bg-amber-50 text-amber-700 ring-amber-200">
                          Partner
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-1.5 text-sm text-slate-600">
                    {contact.contactName || "No contact name"}
                  </div>
                  {contact.services.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {contact.services.map((service) => (
                        <span
                          key={service}
                          className="rounded-sm border border-line bg-mist px-2 py-1 text-[11px] text-slate-600"
                        >
                          {service}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 grid gap-3 border-t border-line pt-3">
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Invoiced</div>
                        <div className="mt-1 font-semibold text-ink">{formatCurrencyOrDash(contact.totalClientValue)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Live work</div>
                        <div className="mt-1 font-semibold text-ink">{formatCurrencyOrDash(contact.liveWorkValue)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Projected</div>
                        <div className="mt-1 font-semibold text-ink">{formatCurrencyOrDash(oppTotals.get(contact.id) ?? 0)}</div>
                      </div>
                    </div>
                    <div className="text-sm">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Date Added</div>
                      <div className="mt-1 text-slate-600">{formatDate(contact.dateAdded)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openExistingContact(contact)}
                        className="min-h-[44px] flex-1 rounded-md border border-line px-3 py-2 text-sm font-medium text-slate-600 hover:border-brand hover:text-ink"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(contact.id)}
                        className="min-h-[44px] min-w-[44px] rounded-md border border-line p-2 text-rose-500 hover:bg-rose-50"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-4 py-12 text-center text-slate-500">
                No contacts match the current search and filters.
              </div>
            )}
          </div>
        </section>}

        {activeTab === "crm" && <>
        <input
          ref={importFileRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(event) => handleImportFile(event.target.files?.[0], "General import")}
        />
        <input
          ref={dataLoadRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(event) => handleImportFile(event.target.files?.[0], "Initial CRM load")}
        />
        </>}
      </div>

      {activeContact ? (
        <ModalShell
          title={isNewContact ? "Add Contact" : activeContact.company || "Contact Detail"}
          subtitle={
            isNewContact
              ? "Create a new CRM record."
              : `Added ${formatDate(activeContact.dateAdded)} · Updated ${formatDate(
                  activeContact.lastUpdated,
                )}`
          }
          onClose={() => {
            setActiveContact(null);
            setIsNewContact(false);
          }}
        >
          {potentialDuplicate && (
            <div className="mx-5 mt-4 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 sm:mx-6">
              <span className="flex-shrink-0">⚠</span>
              <span>
                Possible duplicate:{" "}
                <button
                  type="button"
                  onClick={() => setActiveContact({ ...potentialDuplicate, services: [...potentialDuplicate.services] })}
                  className="font-semibold underline hover:no-underline"
                >
                  {potentialDuplicate.contactName || potentialDuplicate.company}
                </button>
                {potentialDuplicate.company ? ` at ${potentialDuplicate.company}` : ""}. View.
              </span>
            </div>
          )}
          <div className="grid gap-6 px-5 py-5 lg:grid-cols-[1.2fr_0.8fr] sm:px-6 sm:py-6">
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <DetailField label="Company / Organisation">
                  <CompanyAutocomplete
                    value={activeContact.company}
                    onChange={(event) => updateActiveContact("company", event.target.value)}
                    suggestions={uniqueCompanyNames}
                  />
                </DetailField>
                <DetailField label="Contact Name">
                  <TextInput
                    value={activeContact.contactName}
                    onChange={(event) =>
                      updateActiveContact("contactName", event.target.value)
                    }
                  />
                </DetailField>
                <DetailField label="Email Address">
                  <TextInput
                    type="email"
                    value={activeContact.email}
                    onChange={(event) => updateActiveContact("email", event.target.value)}
                  />
                </DetailField>
                <DetailField label="Phone">
                  <TextInput
                    value={activeContact.phone}
                    onChange={(event) => updateActiveContact("phone", event.target.value)}
                  />
                </DetailField>
                <DetailField label="Type">
                  <SelectInput
                    value={activeContact.type}
                    onChange={(event) => updateActiveContact("type", event.target.value)}
                  >
                    {TYPE_OPTIONS.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </SelectInput>
                </DetailField>
                <DetailField label="Source">
                  <SelectInput
                    value={activeContact.source}
                    onChange={(event) => updateActiveContact("source", event.target.value)}
                  >
                    {SOURCE_OPTIONS.map((source) => (
                      <option key={source}>{source}</option>
                    ))}
                  </SelectInput>
                </DetailField>
                <DetailField label="Network Partner">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none mt-1">
                    <input
                      type="checkbox"
                      checked={activeContact.networkPartner ?? false}
                      onChange={(e) => updateActiveContact("networkPartner", e.target.checked)}
                      className="h-4 w-4 rounded border-line accent-brand"
                    />
                    <span className="text-sm text-slate-700">This organisation is a network partner</span>
                  </label>
                </DetailField>
                <DetailField label="Projected Value (GBP)">
                  <div className="rounded-md border border-line bg-mist px-4 py-3 text-sm text-ink">
                    {formatCurrencyOrDash(oppTotals.get(activeContact?.id) ?? 0)}
                    <span className="ml-2 text-xs text-slate-400">derived from Opportunities</span>
                  </div>
                </DetailField>
                <DetailField label="Services">
                  <div className="flex flex-wrap gap-2">
                    {SERVICE_OPTIONS.map((service) => {
                      const active = activeContact.services.includes(service);
                      return (
                        <button
                          key={service}
                          type="button"
                          onClick={() => toggleActiveService(service)}
                          className={`rounded-md border px-3 py-2 text-sm font-medium transition ${
                            active
                              ? "border-brand bg-brand text-white"
                              : "border-line bg-white text-slate-600 hover:border-brand hover:bg-mist"
                          }`}
                        >
                          {service}
                        </button>
                      );
                    })}
                  </div>
                </DetailField>
                <DetailField label="Platforms">
                  <div className="flex flex-wrap gap-2">
                    {PLATFORM_OPTIONS.map((platform) => {
                      const active = activeContact.platforms.includes(platform);
                      return (
                        <button
                          key={platform}
                          type="button"
                          onClick={() => toggleActivePlatform(platform)}
                          className={`rounded-md border px-3 py-2 text-sm font-medium transition ${
                            active
                              ? "border-brand bg-brand text-white"
                              : "border-line bg-white text-slate-600 hover:border-brand hover:bg-mist"
                          }`}
                        >
                          {platform}
                        </button>
                      );
                    })}
                  </div>
                </DetailField>
              </div>

              <DetailField label="Notes">
                <TextArea
                  value={activeContact.notes}
                  onChange={(event) => updateActiveContact("notes", event.target.value)}
                />
              </DetailField>
            </div>

            <div className="space-y-4">
              <div className="border border-line bg-mist p-5">
                <div className="text-sm font-semibold text-ink">Snapshot</div>
                <div className="mt-4 space-y-3 text-sm text-slate-600">
                  <div>
                    <span className="font-medium text-ink">Type:</span> {activeContact.type}
                  </div>
                  <div className="border-t border-line pt-3">
                    <div className="flex items-end justify-between gap-4">
                      <span className="text-sm font-medium text-slate-500">Total invoiced</span>
                      <span className="font-display text-3xl font-normal tracking-[0.02em] leading-none text-brand">
                        {formatCurrencyOrDash(activeContact.totalClientValue)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-end justify-between gap-4">
                    <span className="text-sm font-medium text-slate-500">Live work</span>
                    <span className="text-lg font-semibold text-ink">
                      {formatCurrencyOrDash(activeContact.liveWorkValue)}
                    </span>
                  </div>
                  <div className="flex items-end justify-between gap-4">
                    <span className="text-sm font-medium text-slate-500">Projected</span>
                    <span className="text-base font-medium text-slate-600">
                      {formatCurrencyOrDash(oppTotals.get(activeContact.id) ?? 0)}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-ink">Services:</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {activeContact.services.length ? (
                      activeContact.services.map((service) => (
                        <span
                          key={service}
                          className="rounded-sm border border-line bg-white px-3 py-1 text-xs font-medium text-inkSoft"
                        >
                          {service}
                        </span>
                      ))
                    ) : (
                      <span className="text-slate-400">No services selected</span>
                    )}
                  </div>
                </div>
              </div>

              {!isNewContact ? (
                <ContactResearchIntelPanel
                  contact={activeContact}
                  onResearchSaved={(fields) =>
                    setActiveContact((prev) => ({ ...prev, ...fields }))
                  }
                />
              ) : null}

              {!isNewContact ? (
                <ContactProposalsPanel
                  contact={activeContact}
                  onReplied={() => setActivityRefreshKey((k) => k + 1)}
                />
              ) : null}

              {!isNewContact ? (
                <ContactOpportunitiesPanel contact={activeContact} onOppChange={refreshOppTotals} />
              ) : null}

              {!isNewContact ? (
                <ContactActivitiesPanel
                  contact={activeContact}
                  refreshKey={activityRefreshKey}
                />
              ) : null}

              {!isNewContact ? (
                <ContactSessionsPanel
                  contact={activeContact}
                  contacts={contacts}
                  onNewSession={(contact) => {
                    setClientAreaLaunchContact(contact);
                    setActiveContact(null);
                    setIsNewContact(false);
                    setActiveTab("client-area");
                  }}
                />
              ) : null}

              {!isNewContact ? (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(activeContact.id)}
                  className="inline-flex items-center gap-2 rounded-md border border-line px-4 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50"
                >
                  <Trash2 size={15} />
                  Delete Contact
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:px-6 sm:py-5">
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setActiveContact(null);
                  setIsNewContact(false);
                }}
                className="min-h-[44px] flex-1 rounded-md border border-line px-5 py-2.5 text-sm font-semibold uppercase tracking-wide text-slate-600 transition hover:border-brand hover:text-ink sm:flex-none"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveActiveContact}
                className="min-h-[44px] flex-1 rounded-md bg-brand px-5 py-2.5 text-sm font-semibold uppercase tracking-wide text-white transition hover:bg-brandHover sm:flex-none"
              >
                Save Contact
              </button>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {importState ? (
        <ModalShell
          title={`Import CRM Data`}
          subtitle={`${importState.sourceLabel} · ${importState.fileName}`}
          onClose={() => setImportState(null)}
        >
          <div className="space-y-6 px-6 py-6">
            {importState.sourceLabel === "Initial CRM load" &&
            importState.missingExpectedHeaders.length ? (
              <div className="border border-brand bg-brandSoft px-4 py-3 text-sm text-ink">
                Some expected headers were not found:{" "}
                {importState.missingExpectedHeaders.join(", ")}.
              </div>
            ) : null}

            <div>
              <h3 className="text-lg font-semibold text-ink">Column Mapping</h3>
              <p className="mt-1 text-sm text-slate-500">
                Review the auto-detected mapping before building the import preview.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {IMPORT_FIELDS.map((field) => (
                <label key={field} className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    {FIELD_LABELS[field] || field}
                  </div>
                  <SelectInput
                    value={importState.mapping[field] || ""}
                    onChange={(event) =>
                      setImportState((current) => ({
                        ...current,
                        mapping: {
                          ...current.mapping,
                          [field]: event.target.value,
                        },
                        preview: null,
                      }))
                    }
                  >
                    <option value="">Not mapped</option>
                    {importState.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </SelectInput>
                </label>
              ))}
            </div>

            {!importState.preview ? (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={buildImportPreview}
                  className="rounded-md bg-brand px-5 py-2.5 text-sm font-semibold uppercase tracking-[0.12em] text-white transition hover:bg-brandHover"
                >
                  Build Import Preview
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-3">
                  <PreviewCard
                    label="Rows Parsed"
                    value={importState.preview.totalPrepared}
                  />
                  <PreviewCard
                    label="New Contacts"
                    value={importState.preview.fresh.length}
                  />
                  <PreviewCard
                    label="Duplicates Found"
                    value={importState.preview.duplicates.length}
                  />
                </div>

                {importState.preview.duplicates.length ? (
                  <div className="space-y-3">
                    <div>
                      <h4 className="text-base font-semibold text-ink">Duplicate Review</h4>
                      <p className="text-sm text-slate-500">
                        Choose Merge, Replace, or Skip for each potential duplicate.
                      </p>
                    </div>
                    <div className="space-y-4">
                      {importState.preview.duplicates.map((item) => (
                        <div
                          key={item.importId}
                          className="border border-line p-4"
                        >
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div className="border border-line bg-mist p-4">
                              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                                Existing
                              </div>
                              <div className="mt-2 font-semibold text-ink">
                                {item.existing.company || "Untitled company"}
                              </div>
                              <div className="mt-1 text-sm text-slate-600">
                                {item.existing.contactName || "No contact name"} ·{" "}
                                {item.existing.email || "No email"}
                              </div>
                            </div>
                            <div className="border border-brand/30 bg-brandSoft p-4">
                              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                                Incoming
                              </div>
                              <div className="mt-2 font-semibold text-ink">
                                {item.incoming.company || "Untitled company"}
                              </div>
                              <div className="mt-1 text-sm text-slate-600">
                                {item.incoming.contactName || "No contact name"} ·{" "}
                                {item.incoming.email || "No email"}
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            {["merge", "replace", "skip"].map((action) => (
                              <button
                                key={action}
                                type="button"
                                onClick={() =>
                                  setImportState((current) => ({
                                    ...current,
                                    preview: {
                                      ...current.preview,
                                      duplicates: current.preview.duplicates.map((duplicate) =>
                                        duplicate.importId === item.importId
                                          ? { ...duplicate, action }
                                          : duplicate,
                                      ),
                                    },
                                  }))
                                }
                                className={`rounded-md border px-4 py-2 text-sm font-medium uppercase tracking-[0.08em] transition ${
                                  item.action === action
                                    ? "border-brand bg-brand text-white"
                                    : "border-line bg-white text-slate-600 hover:border-brand hover:bg-mist"
                                }`}
                              >
                                {action}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setImportState((current) => ({
                        ...current,
                        preview: null,
                      }))
                    }
                    className="rounded-md border border-line px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-brand hover:text-ink"
                  >
                    Back to Mapping
                  </button>
                  <button
                    type="button"
                    onClick={applyImport}
                    className="rounded-md bg-brand px-5 py-2.5 text-sm font-semibold uppercase tracking-[0.12em] text-white transition hover:bg-brandHover"
                  >
                    Apply Import
                  </button>
                </div>
              </div>
            )}
          </div>
        </ModalShell>
      ) : null}

      {confirmDeleteId ? (() => {
        const contactToDelete = contacts.find((c) => c.id === confirmDeleteId);
        const name = contactToDelete?.contactName || contactToDelete?.company || "this contact";
        return (
          <ModalShell
            title={`Delete ${name}?`}
            subtitle="This cannot be undone. Any proposals linked to this contact will be unlinked."
            onClose={() => !isDeleting && setConfirmDeleteId(null)}
          >
            <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-5">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                disabled={isDeleting}
                className="rounded-md border border-line px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-brand hover:text-ink disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDeleteConfirm(confirmDeleteId)}
                disabled={isDeleting}
                className="rounded-md bg-rose-600 px-5 py-2.5 text-sm font-semibold uppercase tracking-[0.12em] text-white transition hover:bg-rose-700 disabled:opacity-50"
              >
                {isDeleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </ModalShell>
        );
      })() : null}

      {/* Company-wide service sync toast */}
      {companyToast ? (
        <div className="fixed bottom-4 left-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-line bg-white px-4 py-3 shadow-lg sm:left-auto sm:right-6 sm:w-auto sm:max-w-sm">
          <span className="h-2 w-2 flex-shrink-0 rounded-full bg-brand" />
          <span className="text-sm font-medium text-ink">{companyToast}</span>
        </div>
      ) : null}

      {/* Mailchimp sync toast */}
      {mailchimpToast ? (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border border-line bg-white px-4 py-3 shadow-lg">
          <span className="h-2 w-2 flex-shrink-0 rounded-full bg-brand" />
          <span className="text-sm font-medium text-ink">{mailchimpToast}</span>
        </div>
      ) : null}
    </div>
  );
}

function SummaryCard({ label, value, className = "", onClick }) {
  const interactive = Boolean(onClick);
  return (
    <div
      className={`px-4 py-4 sm:px-5 sm:py-5 ${interactive ? "cursor-pointer transition-colors hover:bg-mist" : ""} ${className}`}
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e) => e.key === "Enter" && onClick() : undefined}
    >
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 font-display text-[28px] font-normal tracking-[0.02em] leading-none text-brand">
        {value}
      </div>
    </div>
  );
}

function ActionButton({ children, onClick, icon, variant = "primary", className = "" }) {
  const styles =
    variant === "primary"
      ? "bg-brand text-white hover:bg-brandHover"
      : "border border-brand bg-white text-brand hover:bg-brandSoft";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold uppercase tracking-[0.14em] transition ${styles} ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}

function SortableHeader({ children, onClick, active, direction, className }) {
  const isRightAligned = className?.includes("text-right");
  return (
    <th className={`px-4 py-4 font-semibold${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-2 ${isRightAligned ? "w-full justify-end" : ""}`}
      >
        {children}
        <span className={active ? "text-ink" : "text-slate-300"}>
          {active ? (direction === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}

function PreviewCard({ label, value }) {
  return (
    <div className="border border-line bg-mist px-4 py-4">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </div>
      <div className="mt-2 font-display text-[28px] font-normal tracking-[0.02em] leading-none text-brand">
        {value}
      </div>
    </div>
  );
}

function SyncDot({ status }) {
  const colorMap = {
    local: "bg-slate-500",
    syncing: "bg-brand animate-pulse",
    synced: "bg-brand",
    error: "bg-red-500",
  };
  const labelMap = {
    local: "Local only",
    syncing: "Saving…",
    synced: "Saved to local file",
    error: "Save failed. Check your connection and try again.",
  };
  return (
    <span
      title={labelMap[status] ?? "Local only"}
      className={`h-2 w-2 rounded-full ${colorMap[status] ?? "bg-slate-500"}`}
    />
  );
}
