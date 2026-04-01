import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import diagonalThinkingLogo from "./assets/diagonal-thinking-logo.png";
import Papa from "papaparse";
import { loadContacts, saveAllContacts, isSupabaseMode, loadProposals, saveProposal, deleteProposal, loadProposalAccesses, loadContactProposals, deleteContact as deleteContactApi } from "./db.js";
import { signOut } from "./AuthWrapper.jsx";
import ProposalWriterForm from "./proposals/ProposalForm.jsx";
import {
  Download,
  FileSpreadsheet,
  Filter,
  Plus,
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

// LOCAL_API_URL is managed by db.js — use loadContacts/saveAllContacts instead
const TYPE_OPTIONS = ["Client", "Warm Lead", "Cold Lead", "Mailing List"];
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
  Client: "#10b981",
  "Warm Lead": "#3B5CB5",
  "Cold Lead": "#0ea5e9",
  "Mailing List": "#94a3b8",
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
  return Number(value) ? formatCurrency(value) : "—";
}

function formatDate(value) {
  if (!value) return "—";
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
  // Acronym match — e.g. "MM" or "GMC" (2+ chars, no spaces)
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
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-950/50 sm:items-start sm:px-4 sm:py-8">
      <div className="w-full max-w-5xl rounded-t-xl border border-line bg-white shadow-panel sm:rounded-xl">
        <div className="flex items-start justify-between border-b border-line px-5 py-4 sm:px-6 sm:py-5">
          <div>
            <h2 className="font-editorial text-2xl font-bold text-ink sm:text-3xl">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-md border border-line p-2 text-slate-500 transition hover:border-black hover:text-ink"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-line bg-white px-6 py-4">
          <div>
            <div className="font-semibold text-ink">{proposal.program_title}</div>
            <div className="text-xs text-slate-500">Access history · Code: {proposal.proposal_code}</div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto px-6 py-4">
          {loading && <div className="text-sm text-slate-500">Loading...</div>}
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
    proposal?.contacts ? `${proposal.contacts.contact_name ?? ""} — ${proposal.contacts.company ?? ""}` : ""
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
        setContactSearch(`${selectedContact.contactName} — ${selectedContact.company}`);
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
    setContactSearch(`${c.contactName} — ${c.company}`);
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
        <div className="flex flex-col gap-4 border-b border-line bg-white px-6 py-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
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
          <button type="button" onClick={closeWithGuard} className="text-slate-400 hover:text-slate-600">
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
        <div className="flex flex-col gap-3 border-t border-line px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-slate-400">
            {isDirty ? "Unsaved changes" : "All changes saved in this draft session"}
          </div>
          <div className="flex justify-end gap-2">
          <button type="button" onClick={closeWithGuard} className="rounded-md border border-line px-4 py-2 text-sm text-slate-500 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
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

function ContactProposalsPanel({ contact }) {
  const [proposals, setProposals] = useState(null); // null = loading

  useEffect(() => {
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
  }, [contact.id]);

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
            </div>
          ))}
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

  return (
    <div>
      {/* Proposals header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="font-editorial text-2xl font-bold text-ink">Proposals</h2>
          <p className="mt-1 text-sm text-slate-500">
            {isSupabaseMode() ? `${proposals.length} proposal${proposals.length !== 1 ? "s" : ""}` : "Connect to Supabase to manage proposals"}
          </p>
        </div>
        {isSupabaseMode() && (
          <button
            type="button"
            onClick={() => setEditingProposal(null)}
            className="flex items-center gap-2 bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90"
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
                      <span className="text-slate-300 italic">—</span>
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
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingProposal(p)}
                        className="text-xs text-brand hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => copyLink(p)}
                        className="text-xs text-slate-500 hover:text-brand"
                        title={`Copy client link for code ${p.proposal_code}`}
                      >
                        {copied === p.id ? "Copied!" : "Copy link"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setAccessProposal(p)}
                        className="text-xs text-slate-500 hover:text-brand"
                      >
                        Accesses
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(p)}
                        className="text-xs text-red-400 hover:text-red-600"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
  const [syncStatus, setSyncStatus] = useState("syncing");
  const initialLoadDoneRef = useRef(false);
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
  const [importState, setImportState] = useState(null);
  const [importSummary, setImportSummary] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [companyToast, setCompanyToast] = useState(null);
  const companyToastTimerRef = useRef(null);
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
    setSyncStatus("syncing");
    saveAllContacts(contacts)
      .then(() => setSyncStatus("synced"))
      .catch(() => setSyncStatus("error"));
  }, [contacts]);

  // Load contacts on mount
  useEffect(() => {
    loadContacts()
      .then((data) => {
        if (Array.isArray(data)) {
          setContacts(data.map(createContactRecord));
          setSyncStatus("synced");
        }
        initialLoadDoneRef.current = true;
      })
      .catch(() => {
        setSyncStatus("error");
        initialLoadDoneRef.current = true;
      });
  }, []);

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
      const a = left[sortConfig.key];
      const b = right[sortConfig.key];

      if (
        sortConfig.key === "totalClientValue" ||
        sortConfig.key === "liveWorkValue" ||
        sortConfig.key === "projectedValue"
      ) {
        return (Number(a) - Number(b)) * direction;
      }

      return String(a).localeCompare(String(b)) * direction;
    });

    return result;
  }, [contacts, search, typeFilter, serviceFilter, sortConfig, networkPartnerFilter]);

  const stats = useMemo(() => {
    const counts = TYPE_OPTIONS.reduce(
      (accumulator, type) => ({
        ...accumulator,
        [type]: contacts.filter((contact) => contact.type === type).length,
      }),
      {},
    );

    // Projected Pipeline: Warm Leads only, with a projection attached,
    // deduplicated by company (one entry per company, using the highest value
    // where multiple contacts exist at the same company).
    const warmLeadsWithProjection = contacts.filter(
      (c) => c.type === "Warm Lead" && Number(c.projectedValue) > 0,
    );
    const projectionByCompany = new Map();
    warmLeadsWithProjection.forEach((c) => {
      const key = c.company?.trim() || c.id;
      const existing = projectionByCompany.get(key) ?? 0;
      if (Number(c.projectedValue) > existing) {
        projectionByCompany.set(key, Number(c.projectedValue));
      }
    });
    const projected = Array.from(projectionByCompany.values()).reduce(
      (sum, val) => sum + val,
      0,
    );
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
  }, [contacts]);

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
        <header className="overflow-hidden rounded-none border-y border-black bg-white shadow-panel sm:rounded-xl sm:border sm:border-line">
          {/* Top brand bar */}
          <div className="border-b border-line bg-white px-5 py-3 sm:px-6">
            <div className="flex items-center justify-between">
              <img
                src={diagonalThinkingLogo}
                alt="Diagonal Thinking"
                className="h-10 w-auto"
              />
              <div className="flex items-center gap-3">
                <SyncDot status={syncStatus} />
                {isSupabaseMode() && (
                  <button
                    type="button"
                    onClick={signOut}
                    className="text-xs text-slate-400 hover:text-slate-600 transition"
                    title="Sign out"
                  >
                    Sign out
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Tab nav */}
          <div className="border-b border-line bg-white px-5 sm:px-6">
            <div className="flex">
              {["crm", "proposals"].map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`px-5 py-3 text-xs font-semibold uppercase tracking-[0.18em] border-b-2 transition-colors ${
                    activeTab === tab
                      ? "border-brand text-brand"
                      : "border-transparent text-slate-400 hover:text-slate-600"
                  }`}
                >
                  {tab === "crm" ? "CRM" : "Proposals"}
                </button>
              ))}
            </div>
          </div>

          {/* Blue hero section — CRM tab only */}
          {activeTab === "crm" && (<>
          <div className="bg-brand px-5 py-7 text-white sm:px-6 sm:py-9">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="font-editorial text-4xl font-bold leading-none sm:text-5xl">
                  Diagonal Thinking CRM
                </h1>
                <p className="mt-3 max-w-xl text-sm leading-6 text-white/84">
                  Consultancy pipeline, relationship notes, and import/export tools
                  for Phil Birchenall&apos;s AI consultancy.
                </p>
              </div>
              <div className="border border-white/25 bg-black px-4 py-3 sm:shrink-0">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
                  Pipeline Summary
                </div>
                <div className="mt-1 text-xl font-bold text-white">
                  {stats.counts["Warm Lead"]} Warm Leads
                </div>
                <div className="mt-0.5 text-sm text-white/70">
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

        {activeTab === "proposals" && (
          <div className="mt-6">
            <ProposalsTab contacts={contacts} />
          </div>
        )}

        {activeTab === "crm" && syncStatus === "error" && (
          <div className="mt-6 border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
            <span className="font-semibold">Could not connect to the local CRM server.</span>{" "}
            Make sure the Express server is running:{" "}
            <code className="font-mono">node server.js</code> in the project folder, then refresh.
            Double-clicking <code className="font-mono">Open CRM.command</code> starts both servers automatically.
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
                <h2 className="font-editorial text-3xl font-semibold text-ink">Dashboard</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Live overview of pipeline health and recent additions.
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_1fr]">
              <div className="border border-line bg-mist p-4">
                <div className="text-sm font-medium text-slate-600">
                  Contacts by Type
                </div>
                <div className="mt-4 h-64">
                  <ResponsiveContainer width="100%" height="100%">
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
                    className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-md bg-black px-4 py-2 text-sm font-semibold uppercase tracking-[0.12em] text-white transition hover:bg-inkSoft"
                  >
                    <FileSpreadsheet size={16} />
                    Load CRM data
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="border border-line bg-white p-5 shadow-panel sm:p-6">
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
            </div>

            <div className="mt-6 space-y-4">
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
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
            <div>
              <h2 className="font-editorial text-3xl font-semibold text-ink">Contact List</h2>
              <p className="mt-1 text-sm text-slate-500">
                {filteredContacts.length} contacts in the current view.
              </p>
            </div>
          </div>

          {/* Desktop table — hidden on small screens */}
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
                        {formatCurrencyOrDash(contact.projectedValue)}
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
                          <span className="text-sm text-slate-400">—</span>
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
                            className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-black hover:text-ink"
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

          {/* Mobile card list — visible only on small screens */}
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
                        <div className="mt-1 font-semibold text-ink">{formatCurrencyOrDash(contact.projectedValue)}</div>
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
                        className="min-h-[44px] flex-1 rounded-md border border-line px-3 py-2 text-sm font-medium text-slate-600 hover:border-black hover:text-ink"
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
                {potentialDuplicate.company ? ` at ${potentialDuplicate.company}` : ""}{" "}— view
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
                  <TextInput
                    inputMode="decimal"
                    value={activeContact.projectedValue}
                    onChange={(event) =>
                      updateActiveContact(
                        "projectedValue",
                        normaliseProjectedValue(event.target.value),
                      )
                    }
                  />
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
                              : "border-line bg-white text-slate-600 hover:border-black hover:bg-mist"
                          }`}
                        >
                          {service}
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
                      <span className="font-editorial text-3xl font-semibold leading-none text-ink">
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
                      {formatCurrencyOrDash(activeContact.projectedValue)}
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
                <ContactProposalsPanel contact={activeContact} />
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

          <div className="flex flex-wrap items-center justify-between border-t border-slate-200 px-6 py-5">
            <div className="text-sm text-slate-500">
              {"Changes are saved to a local JSON file via the CRM server."}
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setActiveContact(null);
                  setIsNewContact(false);
                }}
                className="min-h-[44px] rounded-md border border-line px-5 py-2.5 text-sm font-semibold uppercase tracking-wide text-slate-600 transition hover:border-black hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveActiveContact}
                className="min-h-[44px] rounded-md bg-black px-5 py-2.5 text-sm font-semibold uppercase tracking-wide text-white transition hover:bg-inkSoft"
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
                  className="rounded-md bg-black px-5 py-2.5 text-sm font-semibold uppercase tracking-[0.12em] text-white transition hover:bg-inkSoft"
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
                                    ? "border-black bg-black text-white"
                                    : "border-line bg-white text-slate-600 hover:border-black hover:bg-mist"
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
                    className="rounded-md border border-line px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-black hover:text-ink"
                  >
                    Back to Mapping
                  </button>
                  <button
                    type="button"
                    onClick={applyImport}
                    className="rounded-md bg-black px-5 py-2.5 text-sm font-semibold uppercase tracking-[0.12em] text-white transition hover:bg-inkSoft"
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
                className="rounded-md border border-line px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-black hover:text-ink disabled:opacity-40"
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
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border border-line bg-white px-4 py-3 shadow-lg">
          <span className="h-2 w-2 flex-shrink-0 rounded-full bg-brand" />
          <span className="text-sm font-medium text-ink">{companyToast}</span>
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
      <div className="mt-1 font-editorial text-3xl font-semibold leading-none text-ink">
        {value}
      </div>
    </div>
  );
}

function ActionButton({ children, onClick, icon, variant = "primary", className = "" }) {
  const styles =
    variant === "primary"
      ? "bg-black text-white hover:bg-inkSoft"
      : "border border-line bg-white text-slate-700 hover:border-black hover:bg-mist";

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
      <div className="mt-2 font-editorial text-3xl font-semibold leading-none text-ink">
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
    syncing: "Saving...",
    synced: "Saved to local file",
    error: "Save error — is the CRM server running?",
  };
  return (
    <span
      title={labelMap[status] ?? "Local only"}
      className={`h-2 w-2 rounded-full ${colorMap[status] ?? "bg-slate-500"}`}
    />
  );
}
