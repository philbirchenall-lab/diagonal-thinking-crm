/**
 * db.js — Data access layer for the Diagonal Thinking CRM
 *
 * When VITE_SUPABASE_URL is set (deployed to Vercel), uses Supabase.
 * When not set (running locally via Open CRM.command), uses the local Express API.
 *
 * This lets the local setup work as a fully self-contained fallback with no
 * internet required.
 */

// ─── Mode detection ─────────────────────────────────────────────────────────

const USE_SUPABASE = Boolean(import.meta.env.VITE_SUPABASE_URL);
const LOCAL_API = "http://localhost:3001/api/contacts";
const LOCAL_CLIENT_SESSIONS_KEY = "diagonal-thinking-crm:client-sessions";

// ─── Supabase client (only initialised when env vars present) ───────────────

let supabase = null;

if (USE_SUPABASE) {
  const { createClient } = await import("@supabase/supabase-js");
  supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY
  );
}

// ─── Field name conversion ───────────────────────────────────────────────────

function toSnake(contact) {
  return {
    id: contact.id,
    company: contact.company ?? null,
    contact_name: contact.contactName ?? null,
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    type: contact.type ?? "Warm Lead",
    services: contact.services ?? [],
    projected_value: contact.projectedValue ?? 0,
    notes: contact.notes ?? null,
    source: contact.source ?? null,
    date_added: contact.dateAdded ?? null,
    last_updated: contact.lastUpdated ?? null,
    linkedin_url: contact.linkedinUrl ?? null,
    network_partner: contact.networkPartner ?? false,
    platforms: contact.platforms ?? [],
  };
}

function toCamel(row) {
  return {
    id: row.id,
    company: row.company ?? "",
    contactName: row.contact_name ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    type: row.type ?? "Warm Lead",
    services: row.services ?? [],
    totalClientValue: row.total_client_value ?? 0,
    liveWorkValue: row.live_work_value ?? 0,
    projectedValue: row.projected_value ?? 0,
    notes: row.notes ?? "",
    source: row.source ?? "",
    dateAdded: row.date_added ?? "",
    lastUpdated: row.last_updated ?? "",
    linkedinUrl: row.linkedin_url ?? "",
    networkPartner: row.network_partner ?? false,
    platforms: row.platforms ?? [],
    researchNotes: row.research_notes ?? "",
    researchUpdatedAt: row.research_updated_at ?? "",
    researchSource: row.research_source ?? "",
    researchUpdatedBy: row.research_updated_by ?? "",
  };
}

// ─── Auth (Supabase mode only) ───────────────────────────────────────────────

export function getSupabaseClient() {
  return supabase;
}

export function isSupabaseMode() {
  return USE_SUPABASE;
}

async function readJson(response, fallbackMessage) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || fallbackMessage || `Request failed: ${response.status}`);
  }
  return data;
}

function canUseLocalStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function normaliseSessionRecord(session, index = 0) {
  const resources = Array.isArray(session.resources) ? session.resources : [];
  return {
    id: session.id || `local-session-${index + 1}`,
    slug: session.slug || `local-session-${index + 1}`,
    name: session.name || "Untitled session",
    organisationId: session.organisationId || "",
    organisationName: session.organisationName || "",
    date: session.date || "",
    status: session.status || "active",
    sessionType: session.sessionType || "in_house",
    resources,
    registrations: Array.isArray(session.registrations) ? session.registrations : [],
    engagementLog: Array.isArray(session.engagementLog) ? session.engagementLog : [],
    resourceCount: resources.length,
  };
}

function readLocalClientSessions() {
  if (!canUseLocalStorage()) return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_CLIENT_SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((session, index) => normaliseSessionRecord(session, index));
  } catch {
    return [];
  }
}

function writeLocalClientSessions(sessions) {
  if (!canUseLocalStorage()) return;
  window.localStorage.setItem(LOCAL_CLIENT_SESSIONS_KEY, JSON.stringify(sessions));
}

// ─── Data operations ─────────────────────────────────────────────────────────

export async function loadContacts() {
  if (USE_SUPABASE) {
    const { data, error } = await supabase
      .from("contacts")
      .select("*")
      .order("date_added", { ascending: false, nullsFirst: false });

    if (error) throw new Error(`Supabase load failed: ${error.message}`);
    return data.map(toCamel);
  } else {
    const res = await fetch(LOCAL_API);
    if (!res.ok) throw new Error(`Local API load failed: ${res.status}`);
    return res.json();
  }
}

// ─── Proposals ───────────────────────────────────────────────────────────────

export async function loadProposals() {
  if (!USE_SUPABASE) return [];
  const { data, error } = await supabase
    .from("proposals")
    .select("*, contacts(id, contact_name, company, email)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Supabase proposals load failed: ${error.message}`);
  return data ?? [];
}

export async function saveProposal(proposal) {
  if (!USE_SUPABASE) return null;
  const row = {
    id: proposal.id,
    slug: proposal.slug,
    proposal_code: proposal.proposalCode,
    client_name: proposal.clientName,
    program_title: proposal.programTitle,
    subtitle: proposal.subtitle,
    prepared_for: proposal.preparedFor,
    prepared_by: proposal.preparedBy ?? "Phil Birchenall, DIAGONAL // THINKING",
    date: proposal.date,
    footer_label: proposal.footerLabel ?? "The AI Advantage",
    tiptap_json: proposal.tiptapJson ?? {},
    is_active: proposal.isActive ?? true,
    contact_id: proposal.contactId ?? null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("proposals")
    .upsert(row, { onConflict: "id" })
    .select()
    .single();
  if (error) throw new Error(`Supabase proposal save failed: ${error.message}`);
  return data;
}

export async function deleteProposal(id) {
  if (!USE_SUPABASE) return;
  const { error } = await supabase.from("proposals").delete().eq("id", id);
  if (error) throw new Error(`Supabase proposal delete failed: ${error.message}`);
}

export async function deleteContact(id) {
  if (!USE_SUPABASE) return;
  // Nullify contact_id on any linked proposals before deleting
  // (handles FK regardless of ON DELETE behaviour in the schema)
  await supabase.from("proposals").update({ contact_id: null }).eq("contact_id", id);
  const { error } = await supabase.from("contacts").delete().eq("id", id);
  if (error) throw new Error(`Supabase contact delete failed: ${error.message}`);
}

export async function loadContactProposals(contact) {
  if (!USE_SUPABASE) return [];

  // Primary: match by contact_id
  if (contact.id) {
    const { data, error } = await supabase
      .from("proposals")
      .select("id, slug, program_title, date, proposal_code, reply_received")
      .eq("contact_id", contact.id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Supabase contact proposals load failed: ${error.message}`);
    if (data && data.length > 0) {
      return await attachViewCounts(data);
    }
  }

  // Fallback: match by client_name against contactName or company
  const name = contact.contactName || contact.company;
  if (name) {
    const { data, error } = await supabase
      .from("proposals")
      .select("id, slug, program_title, date, proposal_code, reply_received")
      .ilike("client_name", name)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Supabase contact proposals fallback load failed: ${error.message}`);
    if (data && data.length > 0) {
      return await attachViewCounts(data);
    }
  }

  return [];
}

async function attachViewCounts(proposals) {
  const ids = proposals.map((p) => p.id);
  const { data: accesses, error } = await supabase
    .from("proposal_access")
    .select("proposal_id")
    .in("proposal_id", ids);
  if (error) {
    // Non-fatal: return proposals with 0 views if access table can't be read
    return proposals.map((p) => ({ ...p, views: 0 }));
  }
  const counts = {};
  for (const row of accesses ?? []) {
    counts[row.proposal_id] = (counts[row.proposal_id] ?? 0) + 1;
  }
  return proposals.map((p) => ({ ...p, views: counts[p.id] ?? 0 }));
}

// ─── Contact Activities ───────────────────────────────────────────────────────

// Load activities for a contact (most recent first)
export async function loadContactActivities(contactId) {
  if (!USE_SUPABASE) return [];
  const { data, error } = await supabase
    .from("contact_activities")
    .select("*")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Supabase activities load failed: ${error.message}`);
  return data ?? [];
}

// Save a new activity record
// activity shape: { contactId, proposalId (optional), activityType, activitySubtype, subject, body, status }
export async function saveContactActivity(activity) {
  if (!USE_SUPABASE) return null;
  const { data, error } = await supabase
    .from("contact_activities")
    .insert({
      contact_id: activity.contactId,
      proposal_id: activity.proposalId ?? null,
      activity_type: activity.activityType,
      activity_subtype: activity.activitySubtype ?? null,
      subject: activity.subject ?? null,
      body: activity.body ?? null,
      status: activity.status ?? "sent",
    })
    .select()
    .single();
  if (error) throw new Error(`Supabase activity save failed: ${error.message}`);
  return data;
}

// Mark a proposal as replied (sets reply_received = true)
export async function markProposalReplied(proposalId) {
  if (!USE_SUPABASE) return;
  const { error } = await supabase
    .from("proposals")
    .update({ reply_received: true })
    .eq("id", proposalId);
  if (error) throw new Error(`Supabase markProposalReplied failed: ${error.message}`);
}

// Update a contact activity status (e.g. 'pending' -> 'sent')
export async function updateActivityStatus(activityId, status) {
  if (!USE_SUPABASE) return;
  const { error } = await supabase
    .from("contact_activities")
    .update({ status })
    .eq("id", activityId);
  if (error) throw new Error(`Supabase updateActivityStatus failed: ${error.message}`);
}

// ─── Research & Intel ─────────────────────────────────────────────────────────

// Targeted update for research intel fields only — never overwrites other contact data.
// research shape: { notes, source, updatedBy }
export async function saveContactResearch(contactId, research) {
  if (!USE_SUPABASE) return;
  const { error } = await supabase
    .from("contacts")
    .update({
      research_notes: research.notes ?? null,
      research_source: research.source ?? null,
      research_updated_by: research.updatedBy ?? null,
      research_updated_at: new Date().toISOString(),
    })
    .eq("id", contactId);
  if (error) throw new Error(`Supabase saveContactResearch failed: ${error.message}`);
}

export async function loadProposalAccesses(proposalId) {
  if (!USE_SUPABASE) return [];
  const { data, error } = await supabase
    .from("proposal_access")
    .select("*")
    .eq("proposal_id", proposalId)
    .order("accessed_at", { ascending: false });
  if (error) throw new Error(`Supabase accesses load failed: ${error.message}`);
  return data ?? [];
}

// Upsert a single contact to Supabase by primary key.
// Use this for individual creates/updates — more reliable than saveAllContacts
// for single rows and avoids the large-batch URL-length pitfall.
export async function upsertContact(contact) {
  if (!USE_SUPABASE) return;
  const row = toSnake(contact);
  const { error } = await supabase
    .from("contacts")
    .upsert(row, { onConflict: "id" });
  if (error) throw new Error(`Supabase contact save failed: ${error.message}`);
}

export async function saveAllContacts(contacts) {
  if (USE_SUPABASE) {
    // Deduplicate by email before upserting — prevents unique-constraint violations
    // when a contact-form submission creates a record with a different UUID but the
    // same email as a row already in the local state. Keep the most recently updated
    // version (by last_updated, falling back to date_added).
    const seen = new Map();
    for (const c of contacts) {
      const key = (c.email || "").toLowerCase().trim();
      if (!key) { seen.set(c.id, c); continue; }
      const prev = seen.get(key);
      if (!prev || (c.lastUpdated || c.dateAdded || "") > (prev.lastUpdated || prev.dateAdded || "")) {
        seen.set(key, c);
      }
    }
    const deduped = Array.from(seen.values());
    const rows = deduped.map(toSnake);

    // Remove DB rows whose email matches a contact in this batch but whose ID
    // differs (ghost rows from Sol API or contact-form that would block the upsert's
    // email unique constraint). We fetch only the email-matched DB rows (small result
    // set), then filter client-side — this avoids putting hundreds of UUIDs into the
    // URL query string, which exceeds PostgREST's request-size limits.
    const emailedContacts = deduped.filter((c) => c.email);
    if (emailedContacts.length > 0) {
      const emails = emailedContacts.map((c) => c.email.toLowerCase().trim());
      const keepIdSet = new Set(emailedContacts.map((c) => c.id));

      // Batch emails into chunks of 100 to stay within PostgREST URL limits
      const CHUNK = 100;
      const conflictIds = [];
      for (let i = 0; i < emails.length; i += CHUNK) {
        const chunk = emails.slice(i, i + CHUNK);
        const { data: dbRows, error: conflictErr } = await supabase
          .from("contacts")
          .select("id, email")
          .in("email", chunk);
        if (conflictErr) throw new Error(`Supabase conflict check failed: ${conflictErr.message}`);
        for (const row of dbRows ?? []) {
          if (!keepIdSet.has(row.id)) conflictIds.push(row.id);
        }
      }

      if (conflictIds.length > 0) {
        const { error: preCleanErr } = await supabase
          .from("contacts")
          .delete()
          .in("id", conflictIds);
        if (preCleanErr) throw new Error(`Supabase pre-clean failed: ${preCleanErr.message}`);
      }
    }

    // Upsert all current contacts, matching on primary key (id)
    const { error: upsertErr } = await supabase.from("contacts").upsert(rows, { onConflict: "id" });
    if (upsertErr) throw new Error(`Supabase upsert failed: ${upsertErr.message}`);

    // Note: explicit contact deletes go through deleteContact(id) — we do NOT
    // do a "delete orphans" pass here because that approach is unsafe (a stale
    // local state would silently wipe contacts added via Sol API or contact forms).
  } else {
    // Local mode: POST the full array to Express
    const res = await fetch(LOCAL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(contacts),
    });
    if (!res.ok) throw new Error(`Local API save failed: ${res.status}`);
  }
}

// ─── Client Area sessions ────────────────────────────────────────────────────

export async function loadClientSessions() {
  if (!USE_SUPABASE) {
    return readLocalClientSessions();
  }
  const response = await fetch("/api/client/sessions");
  const data = await readJson(response, "Failed to load client sessions.");
  return data.sessions ?? [];
}

export async function saveClientSession(session) {
  if (!USE_SUPABASE) {
    const existing = readLocalClientSessions();
    const nextSession = normaliseSessionRecord(
      {
        ...session,
        id: session.id || crypto.randomUUID(),
        slug: session.slug || `session-${Date.now()}`,
      },
      0,
    );
    const next = session.id
      ? existing.map((item) => (item.id === session.id ? nextSession : item))
      : [nextSession, ...existing];
    writeLocalClientSessions(next);
    return nextSession;
  }

  const method = session.id ? "PATCH" : "POST";
  const response = await fetch("/api/client/sessions", {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(session),
  });
  const data = await readJson(response, "Failed to save client session.");
  return data.session;
}

// ─── Opportunities ────────────────────────────────────────────────────────────

// Load all opportunities for a specific contact
export async function loadContactOpportunities(contactId) {
  if (!USE_SUPABASE) return [];
  const { data, error } = await supabase
    .from("opportunities")
    .select("*")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Supabase opportunities load failed: ${error.message}`);
  return data ?? [];
}

// Load all opportunities across all contacts (for the pipeline tab), joined with contact info
export async function loadAllOpportunities() {
  if (!USE_SUPABASE) return [];
  const { data, error } = await supabase
    .from("opportunities")
    .select("*, contacts(id, company, contact_name, email)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Supabase all opportunities load failed: ${error.message}`);
  return data ?? [];
}

// Returns a Map: contact_id (string) → total active opportunity value (number)
// "Active" = stage NOT IN ('Won', 'Lost'). Used by App.jsx to derive projected values.
export async function loadContactOpportunityTotals() {
  if (!USE_SUPABASE) return new Map();
  const { data, error } = await supabase
    .from("opportunities")
    .select("contact_id, value, stage");
  if (error) throw new Error(`Supabase opportunity totals load failed: ${error.message}`);
  const totals = new Map();
  for (const opp of data ?? []) {
    if (opp.stage === "Won" || opp.stage === "Lost") continue;
    const existing = totals.get(opp.contact_id) ?? 0;
    totals.set(opp.contact_id, existing + (Number(opp.value) || 0));
  }
  return totals;
}

// Create or update an opportunity.
// opportunity shape: { id (optional), title, description, value, stage, services, close_date, contact_id, proposal_id, notes }
export async function saveOpportunity(opportunity) {
  if (!USE_SUPABASE) return null;
  const stage = opportunity.stage ?? "Identified";
  if (opportunity.id) {
    // Fetch existing to preserve won_at if already set
    const { data: current } = await supabase
      .from("opportunities")
      .select("won_at")
      .eq("id", opportunity.id)
      .single();
    const wonAt = stage === "Won" && current && !current.won_at
      ? new Date().toISOString()
      : (current?.won_at ?? null);
    const { data, error } = await supabase
      .from("opportunities")
      .update({
        title: opportunity.title,
        description: opportunity.description ?? null,
        value: opportunity.value ?? 0,
        stage,
        services: opportunity.services ?? [],
        close_date: opportunity.closeDate || null,
        proposal_id: opportunity.proposalId ?? null,
        notes: opportunity.notes ?? null,
        won_at: wonAt,
      })
      .eq("id", opportunity.id)
      .select()
      .single();
    if (error) {
      if (error.code === "23503") {
        throw new Error(
          "Could not link this opportunity to the contact — the contact may not be saved yet. " +
          "Try refreshing the page (⌘R) and adding the opportunity again."
        );
      }
      throw new Error(`Supabase opportunity update failed: ${error.message}`);
    }
    return data;
  } else {
    const { data, error } = await supabase
      .from("opportunities")
      .insert({
        contact_id: opportunity.contactId ?? null,
        title: opportunity.title,
        description: opportunity.description ?? null,
        value: opportunity.value ?? 0,
        stage,
        services: opportunity.services ?? [],
        close_date: opportunity.closeDate || null,
        proposal_id: opportunity.proposalId ?? null,
        notes: opportunity.notes ?? null,
        won_at: stage === "Won" ? new Date().toISOString() : null,
      })
      .select()
      .single();
    if (error) {
      // Postgres FK violation (23503): the contact_id doesn't exist in the contacts table.
      // This can happen if the contact was created locally but the DB save failed, or the
      // page is stale. Give a clear, actionable message instead of the raw constraint error.
      if (error.code === "23503") {
        throw new Error(
          "Could not link this opportunity to the contact — the contact may not be saved yet. " +
          "Try refreshing the page (⌘R) and adding the opportunity again."
        );
      }
      throw new Error(`Supabase opportunity insert failed: ${error.message}`);
    }
    return data;
  }
}

// Update just the stage of an opportunity (used for quick stage-change in the panel).
// Sets won_at when transitioning to Won (only on first transition — won_at is not overwritten once set).
export async function updateOpportunityStage(opportunityId, stage) {
  if (!USE_SUPABASE) return;
  const updates = { stage };
  if (stage === "Won") {
    // Only stamp won_at if not already set — fetch current value first
    const { data: current } = await supabase
      .from("opportunities")
      .select("won_at")
      .eq("id", opportunityId)
      .single();
    if (current && !current.won_at) {
      updates.won_at = new Date().toISOString();
    }
  }
  const { error } = await supabase
    .from("opportunities")
    .update(updates)
    .eq("id", opportunityId);
  if (error) throw new Error(`Supabase opportunity stage update failed: ${error.message}`);
}

// Delete an opportunity by id
export async function deleteOpportunity(opportunityId) {
  if (!USE_SUPABASE) return;
  const { error } = await supabase.from("opportunities").delete().eq("id", opportunityId);
  if (error) throw new Error(`Supabase opportunity delete failed: ${error.message}`);
}

export async function requestClientMagicLink(payload) {
  if (!USE_SUPABASE) {
    return {
      ok: true,
      mode: "local",
      message: `Local preview only — a real magic link would be sent to ${payload.email}.`,
    };
  }

  const response = await fetch("/api/client/auth/request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return readJson(response, "Failed to send magic link.");
}
