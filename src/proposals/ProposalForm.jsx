import { useEffect, useMemo, useRef, useState } from "react";
import { saveProposal } from "../db.js";
import ProposalEditor from "./ProposalEditor.jsx";
import ProposalPreview from "./ProposalPreview.jsx";
import TextImporter from "./TextImporter.jsx";
import { createGenericProposalDoc, createWorkshopProposalDoc, isDocEmpty } from "./proposalTemplates.js";

const VIEWER_URL = "https://proposals.diagonalthinking.co/view";

function generateSlug(programTitle, clientName) {
  const value = `${programTitle}-${clientName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${value.slice(0, 60)}-${Math.random().toString(36).slice(2, 6)}`;
}

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function todayFormatted() {
  return new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function buildInitialForm(proposal) {
  return {
    clientName: proposal?.client_name ?? "",
    programTitle: proposal?.program_title ?? "",
    subtitle: proposal?.subtitle ?? "",
    preparedFor: proposal?.prepared_for ?? "",
    preparedBy: proposal?.prepared_by ?? "Phil Birchenall, DIAGONAL // THINKING",
    proposalCode: proposal?.proposal_code ?? "",
    date: proposal?.date ?? todayFormatted(),
    footerLabel: proposal?.footer_label ?? "The AI Advantage",
    isActive: proposal?.is_active ?? true,
    contactId: proposal?.contact_id ?? null,
  };
}

function buildInitialDoc(proposal) {
  if (proposal?.tiptap_json && !isDocEmpty(proposal.tiptap_json)) {
    return proposal.tiptap_json;
  }
  return createGenericProposalDoc(proposal?.client_name ?? "", proposal?.program_title ?? "the programme");
}

export default function ProposalForm({ proposal, contacts, onSave, onClose }) {
  const isNew = !proposal;
  const draftKey = useMemo(() => `crm-proposal-draft:${proposal?.id ?? "new"}`, [proposal?.id]);
  const initialForm = useMemo(() => buildInitialForm(proposal), [proposal]);
  const initialDoc = useMemo(() => buildInitialDoc(proposal), [proposal]);

  const [form, setForm] = useState(initialForm);
  const [doc, setDoc] = useState(initialDoc);
  const [contactSearch, setContactSearch] = useState(
    proposal?.contacts ? `${proposal.contacts.contact_name ?? ""}, ${proposal.contacts.company ?? ""}` : ""
  );
  const [showContactDropdown, setShowContactDropdown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState("write");
  const [draftRestored, setDraftRestored] = useState(false);
  const restoreHandledRef = useRef(false);

  const filteredContacts = useMemo(() => {
    const query = contactSearch.toLowerCase();
    return contacts
      .filter((contact) => {
        return (
          contact.contactName.toLowerCase().includes(query) ||
          contact.company.toLowerCase().includes(query) ||
          contact.email.toLowerCase().includes(query)
        );
      })
      .slice(0, 8);
  }, [contactSearch, contacts]);

  const currentSnapshot = useMemo(
    () => JSON.stringify({ form, doc }),
    [form, doc],
  );
  const initialSnapshot = useMemo(
    () => JSON.stringify({ form: initialForm, doc: initialDoc }),
    [initialDoc, initialForm],
  );
  const isDirty = currentSnapshot !== initialSnapshot;

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function selectContact(contact) {
    setForm((current) => ({
      ...current,
      contactId: contact.id,
      clientName: current.clientName || contact.company || contact.contactName,
      preparedFor: [contact.contactName, contact.company].filter(Boolean).join(", "),
    }));
    setContactSearch(`${contact.contactName}, ${contact.company}`);
    setShowContactDropdown(false);
  }

  function handleImport(result) {
    const { coverFields, doc: importedDoc } = result;
    setForm((current) => ({
      ...current,
      programTitle: coverFields.program_title || current.programTitle,
      subtitle: coverFields.subtitle || current.subtitle,
      preparedFor: coverFields.prepared_for || current.preparedFor,
      preparedBy: coverFields.prepared_by || current.preparedBy,
      date: coverFields.date || current.date,
      clientName: current.clientName || current.preparedFor || current.programTitle,
    }));
    setDoc(importedDoc);
  }

  function applyTemplate(templateName) {
    if (templateName === "generic") {
      setDoc(createGenericProposalDoc(form.clientName || "your team", form.programTitle || "the programme"));
      return;
    }
    setDoc(createWorkshopProposalDoc(form.clientName || "your team"));
  }

  function handleClose() {
    if (isDirty && !window.confirm("You have unsaved changes. Close the writer anyway?")) {
      return;
    }
    onClose();
  }

  useEffect(() => {
    if (restoreHandledRef.current) return;
    restoreHandledRef.current = true;

    const rawDraft = window.localStorage.getItem(draftKey);
    if (!rawDraft) return;

    try {
      const parsedDraft = JSON.parse(rawDraft);
      if (parsedDraft.form) setForm((current) => ({ ...current, ...parsedDraft.form }));
      if (parsedDraft.doc) setDoc(parsedDraft.doc);
      if (parsedDraft.contactSearch) setContactSearch(parsedDraft.contactSearch);
      setDraftRestored(true);
    } catch {
      window.localStorage.removeItem(draftKey);
    }
  }, [draftKey]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      window.localStorage.setItem(
        draftKey,
        JSON.stringify({
          form,
          doc,
          contactSearch,
          savedAt: new Date().toISOString(),
        }),
      );
    }, 400);

    return () => window.clearTimeout(timeoutId);
  }, [contactSearch, doc, draftKey, form]);

  useEffect(() => {
    function handleBeforeUnload(event) {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  async function handleSave() {
    if (!form.clientName.trim()) {
      setError("Client name is required.");
      return;
    }
    if (!form.preparedFor.trim()) {
      setError("Prepared for is required.");
      return;
    }
    if (!form.date.trim()) {
      setError("Date is required.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const slug = proposal?.slug ?? generateSlug(form.programTitle || "proposal", form.clientName);
      const code = form.proposalCode || generateCode();

      await saveProposal({
        id: proposal?.id,
        slug,
        proposalCode: code,
        clientName: form.clientName,
        programTitle: form.programTitle,
        subtitle: form.subtitle,
        preparedFor: form.preparedFor,
        preparedBy: form.preparedBy,
        date: form.date,
        footerLabel: form.footerLabel || form.programTitle || "The AI Advantage",
        isActive: form.isActive,
        contactId: form.contactId,
        tiptapJson: doc,
      });

      window.localStorage.removeItem(draftKey);
      onSave();
    } catch (saveError) {
      setError(saveError.message || "Failed to save proposal.");
    } finally {
      setSaving(false);
    }
  }

  function handleCopyLink() {
    const code = proposal?.proposal_code || form.proposalCode;
    if (!code) return;
    navigator.clipboard.writeText(`${VIEWER_URL}?code=${code}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-0 sm:p-4 sm:pt-8">
      <div className="w-full max-w-6xl rounded-none bg-white shadow-xl sm:rounded-xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-line bg-white px-5 py-4 sm:px-6">
          <div>
            <div className="font-semibold text-ink">{isNew ? "New Proposal" : "Edit Proposal"}</div>
            <div className="mt-1 text-xs text-slate-500">
              Build the cover details and full proposal body from one place.
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close proposal editor"
            className="min-h-[44px] min-w-[44px] rounded-md p-2 text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[calc(100vh-132px)] overflow-y-auto px-4 py-5 sm:px-6">
          {draftRestored && (
            <div className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Restored your last local draft for this proposal.
            </div>
          )}

          {!isNew && proposal?.proposal_code && (
            <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-blue-900">Client access link</p>
                  <p className="mt-0.5 text-xs text-blue-700">
                    Share the public viewer with code <strong>{proposal.proposal_code}</strong>.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="rounded border border-blue-300 px-3 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100"
                >
                  {copied ? "Copied!" : "Copy client link"}
                </button>
              </div>
            </div>
          )}

          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
            <div className="grid grid-cols-2 rounded-lg border border-line bg-white p-1">
              {[
                { key: "write", label: "Write" },
                { key: "preview", label: "Preview" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setViewMode(tab.key)}
                  className={`rounded px-3 py-2 text-sm font-medium ${
                    viewMode === tab.key ? "bg-brand text-white" : "text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Quick start</span>
              <button
                type="button"
                onClick={() => applyTemplate("generic")}
                className="min-h-[44px] rounded border border-line px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Generic template
              </button>
              <button
                type="button"
                onClick={() => applyTemplate("workshop")}
                className="min-h-[44px] rounded border border-line px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Workshop template
              </button>
            </div>
          </div>

          <div className="mb-6 grid gap-6 lg:grid-cols-[320px,1fr]">
            <div className="space-y-5">
              <div className="rounded-lg border border-gray-200 bg-white p-5">
                <h2 className="mb-4 text-sm font-semibold text-gray-700">Contact</h2>
                <div className="relative">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Linked contact
                  </label>
                  <input
                    type="text"
                    value={contactSearch}
                    onChange={(event) => {
                      setContactSearch(event.target.value);
                      setShowContactDropdown(true);
                    }}
                    onFocus={() => setShowContactDropdown(true)}
                    placeholder="Search by name, company, or email…"
                    aria-label="Search linked contact"
                    className="w-full border border-line px-3 py-2 text-sm focus:border-brand focus:outline-none"
                  />
                  {showContactDropdown && filteredContacts.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full border border-line bg-white shadow-lg">
                      {filteredContacts.map((contact) => (
                        <button
                          key={contact.id}
                          type="button"
                          onMouseDown={() => selectContact(contact)}
                          className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-slate-50"
                        >
                          <span className="font-medium text-ink">{contact.contactName}</span>
                          <span className="text-xs text-slate-400">{contact.company}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-5">
                <h2 className="mb-4 text-sm font-semibold text-gray-700">Cover details</h2>
                <div className="space-y-4">
                  {[
                    { key: "clientName", label: "Client name *", placeholder: "ACME Corp" },
                    { key: "programTitle", label: "Program title", placeholder: "AI for Leadership Teams" },
                    { key: "subtitle", label: "Subtitle", placeholder: "A tailored programme" },
                    { key: "preparedFor", label: "Prepared for *", placeholder: "Jane Smith, ACME Corp" },
                    { key: "preparedBy", label: "Prepared by", placeholder: "Phil Birchenall, DIAGONAL // THINKING" },
                    { key: "date", label: "Date *", placeholder: "31 March 2026" },
                    { key: "footerLabel", label: "Footer label", placeholder: "The AI Advantage" },
                  ].map(({ key, label, placeholder }) => (
                    <div key={key}>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {label}
                      </label>
                      <input
                        type="text"
                        value={form[key]}
                        onChange={(event) => setField(key, event.target.value)}
                        placeholder={placeholder}
                        className="w-full border border-line px-3 py-2 text-sm focus:border-brand focus:outline-none"
                      />
                    </div>
                  ))}

                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Proposal code
                    </label>
                    <div className="w-full border border-line bg-slate-50 px-3 py-2 text-sm font-mono text-slate-500">
                      {form.proposalCode || <span className="italic">Auto-generated on save</span>}
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      onChange={(event) => setField("isActive", event.target.checked)}
                      className="h-4 w-4 accent-brand"
                    />
                    Active (clients can access this proposal)
                  </label>
                </div>
              </div>
            </div>

            <div>
              <TextImporter onImport={handleImport} />
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="mb-3 border-b border-gray-200 pb-3">
                  <h2 className="text-sm font-semibold text-gray-700">
                    {viewMode === "write" ? "Proposal body" : "Proposal preview"}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {viewMode === "write"
                      ? "Draft directly in the CRM. Formatting is saved to the shared proposals database."
                      : "Review the cover and body together before saving or sharing."}
                  </p>
                </div>
                {viewMode === "write" ? (
                  <ProposalEditor initialContent={doc} onChange={setDoc} />
                ) : (
                  <ProposalPreview
                    proposal={{
                      clientName: form.clientName,
                      programTitle: form.programTitle,
                      subtitle: form.subtitle,
                      preparedFor: form.preparedFor,
                      preparedBy: form.preparedBy,
                      date: form.date,
                      footerLabel: form.footerLabel,
                      doc,
                    }}
                  />
                )}
              </div>
            </div>
          </div>

          {error && (
            <div className="mb-4 border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-line bg-white/95 px-4 py-4 backdrop-blur sm:flex-row sm:justify-end sm:px-6" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
          <button
            type="button"
            onClick={handleClose}
            className="min-h-[44px] rounded-md border border-line px-4 py-2 text-sm text-slate-500 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="min-h-[44px] rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : isNew ? "Create Proposal" : "Save Proposal"}
          </button>
        </div>
      </div>
    </div>
  );
}
