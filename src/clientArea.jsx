import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, ExternalLink, GripVertical, Mail, Plus, X } from "lucide-react";
import {
  isSupabaseMode,
  loadClientSessions,
  requestClientMagicLink,
  saveClientSession,
} from "./db.js";

const CLIENT_AREA_ORIGIN = "https://client.diagonalthinking.co";
const SESSION_TYPE_OPTIONS = [
  { value: "in_house", label: "In-house" },
  { value: "open_event", label: "Open event" },
];

function sessionLandingUrl(slug) {
  return `${CLIENT_AREA_ORIGIN}/?session=${encodeURIComponent(slug)}`;
}

async function downloadQR(url, name) {
  const apiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(url)}&format=png`;
  const resp = await fetch(apiUrl);
  const blob = await resp.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `client-area-qr-${String(name || "session").replace(/\s+/g, "-").toLowerCase()}.png`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function formatSessionDate(value) {
  if (!value) return "TBC";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function emptySession(contact) {
  return {
    id: "",
    name: "",
    slug: "",
    organisationId: contact?.id ?? "",
    organisationName: contact?.company ?? "",
    date: "",
    status: "active",
    sessionType: "in_house",
    resources: [{ id: crypto.randomUUID(), label: "", type: "link", url: "" }],
    registrations: [],
    engagementLog: [],
    resourceCount: 0,
  };
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function matchesSessionToContact(session, contact) {
  // Host organisation match
  if (
    session.organisationId === contact.id ||
    session.organisationId === contact.company ||
    session.organisationName === contact.company
  ) {
    return true;
  }

  // Attendee match — contact registered for this session
  const regs = session.registrations ?? [];
  return regs.some(
    (reg) =>
      (reg.contactId && contact.id && reg.contactId === contact.id) ||
      (reg.email && contact.email && reg.email.toLowerCase() === contact.email.toLowerCase()),
  );
}

/**
 * Combines registrations + engagementLog into a per-attendee summary.
 * Each attendee has: name, email, company, registeredAt, firstAccess,
 * lastAccess, resourcesClicked[].
 * engagementLog entries are assumed to be sorted descending by occurredAt
 * (newest first), matching the API sort order.
 */
function buildAttendeeTable(registrations, engagementLog) {
  const attendeeMap = new Map();

  for (const reg of registrations) {
    const key = reg.contactId || reg.email;
    if (!key) continue;
    attendeeMap.set(key, {
      contactId: reg.contactId || "",
      name: reg.name || "",
      email: reg.email || "",
      company: reg.company || "",
      registeredAt: reg.registeredAt || "",
      engagementEntries: [],
    });
  }

  for (const entry of engagementLog) {
    const key = entry.contactId || entry.email;
    if (!key) continue;
    if (!attendeeMap.has(key)) {
      attendeeMap.set(key, {
        contactId: entry.contactId || "",
        name: entry.contactName || "",
        email: entry.email || "",
        company: entry.company || "",
        registeredAt: "",
        engagementEntries: [],
      });
    }
    attendeeMap.get(key).engagementEntries.push(entry);
  }

  return Array.from(attendeeMap.values()).map((attendee) => {
    const entries = attendee.engagementEntries;
    // entries sorted desc → last item is oldest (first access), first item is newest (last access)
    const firstAccess = entries.length > 0 ? entries[entries.length - 1].occurredAt : "";
    const lastAccess = entries.length > 0 ? entries[0].occurredAt : "";
    const resourcesClicked = [
      ...new Set(entries.map((e) => e.resourceLabel).filter(Boolean)),
    ];
    return {
      contactId: attendee.contactId,
      name: attendee.name,
      email: attendee.email,
      company: attendee.company,
      registeredAt: attendee.registeredAt,
      firstAccess,
      lastAccess,
      resourcesClicked,
    };
  });
}

function getStatusClasses(status) {
  return status === "active"
    ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
    : "bg-slate-100 text-slate-500 ring-1 ring-slate-200";
}

function Field({ label, children }) {
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

function SelectInput(props) {
  return (
    <select
      {...props}
      className="w-full rounded-md border border-line bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
    />
  );
}

function SessionShell({ title, subtitle, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-950/50 sm:items-start sm:px-4 sm:py-8">
      <div className="w-full max-w-6xl rounded-t-xl border border-line bg-white shadow-panel sm:rounded-xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-line bg-white px-5 py-4 sm:px-6 sm:py-5">
          <div>
            <h2 className="font-display text-2xl font-normal uppercase tracking-[0.02em] text-ink sm:text-3xl">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close session editor"
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

function OrganisationPicker({ contacts, value, companyName, onPick, optional }) {
  const [query, setQuery] = useState(companyName || "");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setQuery(companyName || "");
  }, [companyName]);

  const options = useMemo(() => {
    const seen = new Set();
    return contacts
      .filter((contact) => contact.company)
      .filter((contact) => {
        const key = `${contact.id}:${contact.company}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .filter((contact) =>
        !query ||
        contact.company.toLowerCase().includes(query.toLowerCase()) ||
        (contact.contactName || "").toLowerCase().includes(query.toLowerCase()),
      )
      .slice(0, 8);
  }, [contacts, query]);

  return (
    <div className="relative">
      <TextInput
        value={query}
        placeholder={optional ? "Optional organisation reference" : "Search organisation"}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          if (!event.target.value) {
            onPick(null);
          }
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && options.length ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border border-line bg-white shadow-lg">
          {options.map((contact) => (
            <button
              key={contact.id}
              type="button"
              onMouseDown={() => {
                onPick(contact);
                setQuery(contact.company);
                setOpen(false);
              }}
              className="block w-full border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-mist"
            >
              <div className="text-sm font-medium text-ink">{contact.company}</div>
              <div className="text-xs text-slate-500">{contact.contactName || "Contact record"}</div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ResourceEditor({ resources, onChange }) {
  const dragIndexRef = useRef(null);

  function updateRow(index, field, value) {
    onChange(
      resources.map((resource, resourceIndex) =>
        resourceIndex === index ? { ...resource, [field]: value } : resource,
      ),
    );
  }

  function removeRow(index) {
    const next = resources.filter((_, resourceIndex) => resourceIndex !== index);
    onChange(next.length ? next : [{ id: crypto.randomUUID(), label: "", type: "link", url: "" }]);
  }

  function addRow() {
    onChange([
      ...resources,
      { id: crypto.randomUUID(), label: "", type: "link", url: "" },
    ]);
  }

  function reorder(fromIndex, toIndex) {
    if (fromIndex === null || fromIndex === toIndex) return;
    const next = [...resources];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {resources.map((resource, index) => (
        <div
          key={resource.id}
          draggable
          onDragStart={() => {
            dragIndexRef.current = index;
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => {
            reorder(dragIndexRef.current, index);
            dragIndexRef.current = null;
          }}
          className="grid gap-3 border border-line bg-mist p-4 md:grid-cols-[24px_1.2fr_0.8fr_1.4fr_auto]"
        >
          <div className="flex items-center justify-center text-slate-400">
            <GripVertical size={16} />
          </div>
          <TextInput
            placeholder="Label"
            value={resource.label}
            onChange={(event) => updateRow(index, "label", event.target.value)}
          />
          <SelectInput
            value={resource.type}
            onChange={(event) => updateRow(index, "type", event.target.value)}
          >
            <option value="link">Link</option>
            <option value="file">File</option>
            <option value="embed">Embed</option>
          </SelectInput>
          <TextInput
            placeholder="URL"
            value={resource.url}
            onChange={(event) => updateRow(index, "url", event.target.value)}
          />
          <button
            type="button"
            onClick={() => removeRow(index)}
            className="min-h-[44px] rounded-md border border-line px-3 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50 md:self-stretch"
          >
            Remove
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={addRow}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-line px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-brand hover:bg-mist"
      >
        <Plus size={16} />
        Add resource
      </button>
    </div>
  );
}

function AttendeeCard({ attendee }) {
  return (
    <div className="border-t border-line pt-4 first:border-t-0 first:pt-0">
      <div className="font-medium text-ink">{attendee.name || attendee.email}</div>
      {attendee.name ? (
        <div className="text-xs text-slate-500">{attendee.email}</div>
      ) : null}
      {attendee.company ? (
        <div className="text-xs text-slate-500">{attendee.company}</div>
      ) : null}
      <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {attendee.registeredAt ? (
          <>
            <div className="text-xs text-slate-400">Registered</div>
            <div className="text-xs text-slate-600">{attendee.registeredAt}</div>
          </>
        ) : null}
        {attendee.firstAccess ? (
          <>
            <div className="text-xs text-slate-400">First open</div>
            <div className="text-xs text-slate-600">{attendee.firstAccess}</div>
          </>
        ) : null}
        {attendee.lastAccess && attendee.lastAccess !== attendee.firstAccess ? (
          <>
            <div className="text-xs text-slate-400">Last open</div>
            <div className="text-xs text-slate-600">{attendee.lastAccess}</div>
          </>
        ) : null}
      </div>
      {attendee.resourcesClicked.length > 0 ? (
        <div className="mt-2">
          <div className="mb-1 text-xs text-slate-400">Resources opened</div>
          <div className="flex flex-wrap gap-1">
            {attendee.resourcesClicked.map((label) => (
              <span
                key={label}
                className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600"
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SessionEditorModal({ contacts, initialSession, launchEmail, onClose, onSaved }) {
  const [session, setSession] = useState(() => ({
    ...initialSession,
    resources: initialSession.resources?.length
      ? initialSession.resources.map((resource) => ({ ...resource, id: resource.id || crypto.randomUUID() }))
      : [{ id: crypto.randomUUID(), label: "", type: "link", url: "" }],
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [sendEmail, setSendEmail] = useState(launchEmail || "");
  const [sending, setSending] = useState(false);

  const attendees = useMemo(
    () => buildAttendeeTable(session.registrations ?? [], session.engagementLog ?? []),
    [session.registrations, session.engagementLog],
  );

  const landingUrl = session.slug ? sessionLandingUrl(session.slug) : "";

  async function handleSave() {
    setError("");
    setSuccess("");

    if (!session.name.trim()) {
      setError("Session name is required.");
      return;
    }

    if (session.sessionType === "in_house" && !session.organisationId) {
      setError("In-house sessions must be linked to an organisation.");
      return;
    }

    const cleanedResources = session.resources
      .map((resource, index) => ({
        ...resource,
        sortOrder: index,
        label: resource.label.trim(),
        url: resource.url.trim(),
      }))
      .filter((resource) => resource.label && resource.url);

    if (!cleanedResources.length) {
      setError("Add at least one resource before saving.");
      return;
    }

    setSaving(true);
    try {
      const nextSlug = session.slug?.trim() || slugify(session.name) || `session-${Date.now()}`;
      const saved = await saveClientSession({
        ...session,
        slug: nextSlug,
        resources: cleanedResources,
      });
      setSuccess("Session saved.");
      onSaved(saved);
    } catch (saveError) {
      setError(saveError.message || "Failed to save session.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSendMagicLink(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!sendEmail.trim()) {
      setError("Enter an email address before sending.");
      return;
    }

    if (!session.slug) {
      setError("Save the session before sending magic links.");
      return;
    }

    setSending(true);
    try {
      await requestClientMagicLink({
        email: sendEmail.trim().toLowerCase(),
        sessionSlug: session.slug,
      });
      setSuccess(`Magic link sent to ${sendEmail.trim().toLowerCase()}.`);
    } catch (sendError) {
      setError(sendError.message || "Failed to send magic link.");
    } finally {
      setSending(false);
    }
  }

  return (
    <SessionShell
      title={session.name || "New session"}
      subtitle={session.id ? "Edit the session, resources, registrations, and access history." : "Create a new client session."}
      onClose={onClose}
    >
      <div className="grid gap-6 px-5 py-5 lg:grid-cols-[1.15fr_0.85fr] sm:px-6 sm:py-6">
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <TextInput
                value={session.name}
                onChange={(event) =>
                  setSession((current) => ({
                    ...current,
                    name: event.target.value,
                    slug: current.id ? current.slug : slugify(event.target.value),
                  }))
                }
              />
            </Field>

            <Field label="Slug">
              <TextInput
                value={session.slug}
                onChange={(event) =>
                  setSession((current) => ({ ...current, slug: slugify(event.target.value) }))
                }
              />
            </Field>

            <Field label="Session type">
              <SelectInput
                value={session.sessionType}
                onChange={(event) =>
                  setSession((current) => ({ ...current, sessionType: event.target.value }))
                }
              >
                {SESSION_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectInput>
            </Field>

            <Field label="Date">
              <TextInput
                type="date"
                value={session.date || ""}
                onChange={(event) =>
                  setSession((current) => ({ ...current, date: event.target.value }))
                }
              />
            </Field>

            <Field label="Status">
              <SelectInput
                value={session.status}
                onChange={(event) =>
                  setSession((current) => ({ ...current, status: event.target.value }))
                }
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </SelectInput>
            </Field>

            <Field label={session.sessionType === "in_house" ? "Organisation" : "Organisation (optional)"}>
              <OrganisationPicker
                contacts={contacts}
                value={session.organisationId}
                companyName={session.organisationName}
                optional={session.sessionType === "open_event"}
                onPick={(contact) =>
                  setSession((current) => ({
                    ...current,
                    organisationId: contact?.id || "",
                    organisationName: contact?.company || "",
                  }))
                }
              />
            </Field>
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Resources
            </div>
            <ResourceEditor
              resources={session.resources}
              onChange={(resources) =>
                setSession((current) => ({ ...current, resources }))
              }
            />
          </div>

          {error ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}
          {success ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {success}
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="border border-line bg-mist p-5">
            <div className="text-sm font-semibold text-ink">Session summary</div>
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              <div className="flex items-center justify-between gap-4">
                <span>Status</span>
                <span className="font-medium capitalize text-ink">{session.status}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>Type</span>
                <span className="font-medium text-ink">
                  {session.sessionType === "in_house" ? "In-house" : "Open event"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>Resources</span>
                <span className="font-medium text-ink">{session.resources.length}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>Registrations</span>
                <span className="font-medium text-ink">{session.registrations?.length || 0}</span>
              </div>
              {landingUrl ? (
                <div className="border-t border-line pt-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Public page
                  </div>
                  <div className="mt-2 break-all text-xs text-slate-500">{landingUrl}</div>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(landingUrl)}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-brand hover:bg-white"
                    >
                      <Copy size={15} />
                      Copy link
                    </button>
                    <a
                      href={landingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-brand hover:bg-white"
                    >
                      <ExternalLink size={15} />
                      View page
                    </a>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {session.id ? (
            <form onSubmit={handleSendMagicLink} className="border border-line bg-white p-5">
              <div className="text-sm font-semibold text-ink">Send magic link</div>
              <div className="mt-3 space-y-3">
                <TextInput
                  type="email"
                  placeholder="client@example.com"
                  value={sendEmail}
                  onChange={(event) => setSendEmail(event.target.value)}
                />
                <button
                  type="submit"
                  disabled={sending}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold uppercase tracking-[0.12em] text-white transition hover:bg-brandHover disabled:opacity-60"
                >
                  <Mail size={15} />
                  {sending ? "Sending…" : "Send magic link"}
                </button>
              </div>
            </form>
          ) : null}

          {session.id ? (
            <div className="border border-line bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-ink">Attendees</div>
                {attendees.length > 0 ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
                    {attendees.length}
                  </span>
                ) : null}
              </div>
              <div className="mt-3 space-y-0 text-sm">
                {attendees.length ? (
                  attendees.map((attendee) => (
                    <AttendeeCard
                      key={attendee.contactId || attendee.email}
                      attendee={attendee}
                    />
                  ))
                ) : (
                  <div className="text-slate-400">No attendees yet.</div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-white/95 px-5 py-4 backdrop-blur sm:px-6" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
        <div className="text-sm text-slate-500">
          {isSupabaseMode()
            ? "Client Area sessions sync to Supabase and power the public client site."
            : "You’re in local preview mode. Sessions save in this browser so you can test the admin flow without Supabase."}
        </div>
        <div className="flex w-full gap-3 sm:w-auto">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] flex-1 rounded-md border border-line px-5 py-2.5 text-sm font-medium text-slate-600 transition hover:border-brand hover:text-ink sm:flex-none"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="min-h-[44px] flex-1 rounded-md bg-brand px-5 py-2.5 text-sm font-semibold uppercase tracking-[0.12em] text-white transition hover:bg-brandHover disabled:opacity-60 sm:flex-none"
          >
            {saving ? "Saving…" : "Save session"}
          </button>
        </div>
      </div>
    </SessionShell>
  );
}

export function ClientAreaTab({ contacts, launchContact, onLaunchConsumed }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingSession, setEditingSession] = useState(null);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const data = await loadClientSessions();
      setSessions(data);
    } catch (loadError) {
      setError(loadError.message || "Failed to load sessions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!launchContact) return;
    setEditingSession(emptySession(launchContact));
    onLaunchConsumed?.();
  }, [launchContact, onLaunchConsumed]);

  const stats = useMemo(() => {
    const activeCount = sessions.filter((session) => session.status === "active").length;
    const registrationCount = sessions.reduce(
      (total, session) => total + (session.registrations?.length || 0),
      0,
    );
    return {
      total: sessions.length,
      active: activeCount,
      resources: sessions.reduce((total, session) => total + (session.resourceCount || 0), 0),
      registrations: registrationCount,
    };
  }, [sessions]);

  return (
    <div className="mt-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-normal uppercase tracking-[0.02em] text-ink">CLIENT AREA</h2>
          <p className="mt-1 text-sm text-slate-500">
            Manage client session pages, resources, registrations, and magic links.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditingSession(emptySession())}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold uppercase tracking-[0.14em] text-white transition hover:bg-brandHover"
        >
          <Plus size={16} />
          New session
        </button>
      </div>

      <div className="mb-6 grid gap-px overflow-hidden border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Total Sessions", value: stats.total },
          { label: "Active", value: stats.active },
          { label: "Resources", value: stats.resources },
          { label: "Registrations", value: stats.registrations },
        ].map((item) => (
          <div key={item.label} className="bg-white px-4 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              {item.label}
            </div>
            <div className="mt-2 font-display text-[28px] font-normal tracking-[0.02em] leading-none text-brand">{item.value}</div>
          </div>
        ))}
      </div>

      {error ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
          <span>{error}</span>
          <button
            type="button"
            onClick={refresh}
            className="min-h-[40px] rounded-md border border-rose-300 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-rose-700 transition hover:bg-white"
          >
            Retry
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="border border-line bg-white px-5 py-10 text-center text-sm text-slate-400">
          Loading sessions…
        </div>
      ) : (
        <div className="border border-line bg-white">
          <div className="hidden sm:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-mist text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Organisation</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Resources</th>
                  <th className="px-4 py-3">Magic link</th>
                </tr>
              </thead>
              <tbody>
                {sessions.length ? (
                  sessions.map((session) => (
                    <tr key={session.id} className="border-b border-line last:border-0 hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <button type="button" onClick={() => setEditingSession(session)} className="text-left">
                          <div className="font-medium text-ink">{session.name}</div>
                          <div className="text-xs text-slate-500">{session.sessionType === "in_house" ? "In-house" : "Open event"}</div>
                        </button>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{session.organisationName || "-"}</td>
                      <td className="px-4 py-3 text-slate-600">{formatSessionDate(session.date)}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getStatusClasses(session.status)}`}>
                          {session.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{session.resourceCount}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingSession(session)}
                            className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-brand hover:bg-mist"
                          >
                            Magic link
                          </button>
                          <a
                            href={sessionLandingUrl(session.slug)}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-brand hover:bg-mist"
                          >
                            View page
                          </a>
                          <button
                            type="button"
                            onClick={() => downloadQR(sessionLandingUrl(session.slug), session.organisationName || session.name)}
                            className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-brand hover:bg-mist"
                          >
                            ⬇ QR
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="6" className="px-4 py-10 text-center text-slate-400">
                      <div className="mx-auto max-w-md">
                        <div className="font-medium text-ink">No client sessions yet.</div>
                        <div className="mt-1 text-sm text-slate-500">
                          Create a session to send post-event resources, track registrations, and share magic links.
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="space-y-0 sm:hidden">
            {sessions.length ? (
              sessions.map((session) => (
                <div key={session.id} className="border-b border-line p-4 last:border-b-0">
                  <button type="button" onClick={() => setEditingSession(session)} className="w-full text-left">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-ink">{session.name}</div>
                        <div className="mt-1 text-sm text-slate-500">
                          {[session.organisationName || "No organisation", formatSessionDate(session.date)].join(" · ")}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${getStatusClasses(session.status)}`}>
                        {session.status}
                      </span>
                    </div>
                  </button>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-500">
                      {session.resourceCount} resources · {session.sessionType === "in_house" ? "In-house" : "Open event"}
                    </div>
                    <div className="flex gap-2">
                      <a
                        href={sessionLandingUrl(session.slug)}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border border-line px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-brand hover:bg-mist"
                      >
                        View
                      </a>
                      <button
                        type="button"
                        onClick={() => downloadQR(sessionLandingUrl(session.slug), session.organisationName || session.name)}
                        className="rounded-md border border-line px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-brand hover:bg-mist"
                      >
                        ⬇ QR
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingSession(session)}
                        className="rounded-md border border-line px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-brand hover:bg-mist"
                      >
                        Open
                      </button>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-4 py-12 text-center">
                <div className="font-medium text-ink">No client sessions yet.</div>
                <div className="mt-1 text-sm text-slate-500">
                  Start with one session and keep the client-facing resources tidy from here.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {editingSession ? (
        <SessionEditorModal
          key={editingSession.id || "new"}
          contacts={contacts}
          initialSession={editingSession}
          onClose={() => setEditingSession(null)}
          onSaved={(savedSession) => {
            setEditingSession(savedSession);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

export function ContactSessionsPanel({ contact, contacts, onNewSession }) {
  const [sessions, setSessions] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadClientSessions()
      .then((data) => {
        if (!cancelled) setSessions(data.filter((session) => matchesSessionToContact(session, contact)));
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      });

    return () => {
      cancelled = true;
    };
  }, [contact.id, contact.company]);

  return (
    <div className="border border-line bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Client Sessions
        </div>
        <button
          type="button"
          onClick={() => onNewSession?.(contact)}
          className="text-xs font-semibold uppercase tracking-[0.14em] text-brand hover:underline"
        >
          New session
        </button>
      </div>

      {sessions === null ? (
        <div className="mt-3 text-xs text-slate-400">Loading…</div>
      ) : null}

      {sessions !== null && sessions.length === 0 ? (
        <div className="mt-3 text-xs italic text-slate-400">No client sessions yet.</div>
      ) : null}

      {sessions !== null && sessions.length > 0 ? (
        <div className="mt-3 space-y-3">
          {sessions.map((session) => {
            // Compute this contact's engagement within the session
            const contactEvents = (session.engagementLog ?? []).filter(
              (entry) =>
                (entry.contactId && contact.id && entry.contactId === contact.id) ||
                (entry.email && contact.email && entry.email.toLowerCase() === contact.email.toLowerCase()),
            );
            // engagementLog sorted desc → last item = first access, first item = last access
            const firstAccess = contactEvents.length > 0 ? contactEvents[contactEvents.length - 1].occurredAt : null;
            const lastAccess = contactEvents.length > 0 ? contactEvents[0].occurredAt : null;
            const resourcesClicked = [
              ...new Set(contactEvents.map((e) => e.resourceLabel).filter(Boolean)),
            ];

            return (
              <div key={session.id} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
                <div className="text-sm font-medium leading-snug text-ink">{session.name}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-xs text-slate-400">{formatSessionDate(session.date)}</span>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getStatusClasses(session.status)}`}>
                    {session.status}
                  </span>
                  <a
                    href={sessionLandingUrl(session.slug)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
                  >
                    <ExternalLink size={12} />
                    View page
                  </a>
                  <button
                    type="button"
                    onClick={() => downloadQR(sessionLandingUrl(session.slug), contact.contactName || session.organisationName)}
                    className="text-xs text-slate-500 hover:text-slate-800 hover:underline"
                  >
                    ⬇ QR
                  </button>
                </div>
                {(firstAccess || resourcesClicked.length > 0) ? (
                  <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
                    {firstAccess ? (
                      <>
                        <div className="text-xs text-slate-400">First open</div>
                        <div className="text-xs text-slate-600">{firstAccess}</div>
                      </>
                    ) : null}
                    {lastAccess && lastAccess !== firstAccess ? (
                      <>
                        <div className="text-xs text-slate-400">Last open</div>
                        <div className="text-xs text-slate-600">{lastAccess}</div>
                      </>
                    ) : null}
                    {resourcesClicked.length > 0 ? (
                      <>
                        <div className="text-xs text-slate-400">Opened</div>
                        <div className="text-xs text-slate-600">{resourcesClicked.join(", ")}</div>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
