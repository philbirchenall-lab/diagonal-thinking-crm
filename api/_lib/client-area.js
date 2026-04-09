import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const SESSION_STATE_SEPARATOR = "::";
const DEFAULT_CLIENT_AREA_ORIGIN = "https://client.diagonalthinking.co";

function getSupabaseUrl() {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
}

function getSupabaseServiceKey() {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ""
  );
}

export function getSupabaseAdmin() {
  const url = getSupabaseUrl();
  const key = getSupabaseServiceKey();

  if (!url || !key) {
    throw new Error(
      "Supabase admin env vars are missing. Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function decodeSessionState(rawValue) {
  const raw = String(rawValue || "active").trim();
  const [status, sessionType] = raw.split(SESSION_STATE_SEPARATOR);

  return {
    status: status === "inactive" ? "inactive" : "active",
    sessionType: sessionType === "open_event" ? "open_event" : "in_house",
  };
}

export function encodeSessionState(status, sessionType) {
  return status === "inactive" ? "inactive" : "active";
}

function inferSessionType(row) {
  const explicitType = String(row?.session_type || "").trim();
  if (explicitType === "open_event" || explicitType === "in_house") {
    return explicitType;
  }

  const decoded = decodeSessionState(row?.status);
  if (String(row?.status || "").includes(SESSION_STATE_SEPARATOR)) {
    return decoded.sessionType;
  }

  return row?.organisation_id ? "in_house" : "open_event";
}

function formatTimestamp(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function setJobTitleInNotes(notes, jobTitle) {
  if (!jobTitle) return notes || "";

  const cleanTitle = String(jobTitle).trim();
  if (!cleanTitle) return notes || "";

  const lines = String(notes || "")
    .split(/\r?\n/)
    .filter(Boolean);
  const prefix = "Job title:";
  let replaced = false;

  const nextLines = lines.map((line) => {
    if (line.toLowerCase().startsWith(prefix.toLowerCase())) {
      replaced = true;
      return `${prefix} ${cleanTitle}`;
    }
    return line;
  });

  if (!replaced) {
    nextLines.unshift(`${prefix} ${cleanTitle}`);
  }

  return nextLines.join("\n").trim();
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function buildContactName(firstName, lastName) {
  return [firstName, lastName]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
}

export async function getSessionBySlug(supabase, slug) {
  const { data: sessionRow, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!sessionRow) {
    return null;
  }

  const state = decodeSessionState(sessionRow.status);
  let organisationName = "";

  if (sessionRow.organisation_id) {
    const { data: organisation } = await supabase
      .from("contacts")
      .select("id, company")
      .eq("id", sessionRow.organisation_id)
      .maybeSingle();
    organisationName = organisation?.company || "";
  }

  return {
    id: sessionRow.id,
    name: sessionRow.name || "",
    slug: sessionRow.slug || "",
    organisationId: sessionRow.organisation_id || "",
    organisationName,
    date: sessionRow.date || "",
    status: state.status,
    sessionType: state.sessionType,
    createdAt: sessionRow.created_at || "",
  };
}

export async function ensureContactForSessionRegistration(supabase, payload) {
  const email = normalizeEmail(payload.email);
  const firstName = String(payload.firstName || "").trim();
  const lastName = String(payload.lastName || "").trim();
  const jobTitle = String(payload.jobTitle || "").trim();
  const companyNameInput = String(payload.companyName || "").trim();
  const session = payload.session;

  if (!email || !email.includes("@")) {
    throw new Error("A valid email address is required.");
  }

  const derivedCompany =
    session.sessionType === "in_house"
      ? session.organisationName || companyNameInput
      : companyNameInput || session.organisationName || "";
  const contactName = buildContactName(firstName, lastName);

  const { data: existingContact, error: contactLookupError } = await supabase
    .from("contacts")
    .select("*")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();

  if (contactLookupError) {
    throw new Error(contactLookupError.message);
  }

  if (existingContact) {
    const updates = {};

    if (contactName && existingContact.contact_name !== contactName) {
      updates.contact_name = contactName;
    }

    if (derivedCompany && !existingContact.company) {
      updates.company = derivedCompany;
    }

    if (jobTitle) {
      const nextNotes = setJobTitleInNotes(existingContact.notes, jobTitle);
      if (nextNotes !== (existingContact.notes || "")) {
        updates.notes = nextNotes;
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.last_updated = new Date().toISOString();
      const { data: updatedContact, error: updateError } = await supabase
        .from("contacts")
        .update(updates)
        .eq("id", existingContact.id)
        .select("*")
        .single();

      if (updateError) {
        throw new Error(updateError.message);
      }

      return updatedContact;
    }

    return existingContact;
  }

  const insertRow = {
    company: derivedCompany || null,
    contact_name: contactName || null,
    email,
    phone: null,
    type: "Mailing List",
    services: [],
    projected_value: 0,
    notes: jobTitle ? setJobTitleInNotes("", jobTitle) : null,
    source: "Manual",
    network_partner: false,
  };

  const { data: insertedContact, error: insertError } = await supabase
    .from("contacts")
    .insert(insertRow)
    .select("*")
    .single();

  if (insertError) {
    throw new Error(insertError.message);
  }

  return insertedContact;
}

export async function logRegistrationIfNeeded(supabase, sessionId, contactId) {
  const { data: existingLog, error: lookupError } = await supabase
    .from("engagement_log")
    .select("id")
    .eq("session_id", sessionId)
    .eq("contact_id", contactId)
    .eq("event_type", "resource_click")
    .is("resource_id", null)
    .limit(1)
    .maybeSingle();

  if (lookupError) {
    throw new Error(lookupError.message);
  }

  if (existingLog) {
    return existingLog;
  }

  const { data, error } = await supabase
    .from("engagement_log")
    .insert({
      contact_id: contactId,
      session_id: sessionId,
      resource_id: null,
      event_type: "resource_click",
      occurred_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

function createMagicLinkToken() {
  return `${crypto.randomUUID()}-${crypto.randomBytes(18).toString("hex")}`;
}

export async function createMagicLink(supabase, sessionSlug, contactId) {
  const token = createMagicLinkToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("magic_links")
    .insert({
      contact_id: contactId,
      session_slug: sessionSlug,
      token,
      expires_at: expiresAt,
      used_at: null,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function sendMagicLinkEmail({ email, sessionName, token }) {
  const resendKey = process.env.RESEND_API_KEY;

  if (!resendKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  const clientOrigin = process.env.CLIENT_AREA_ORIGIN || DEFAULT_CLIENT_AREA_ORIGIN;
  const verifyUrl = new URL("/verify", clientOrigin);
  verifyUrl.searchParams.set("token", token);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Diagonal Thinking <no-reply@diagonalthinking.co>",
      to: [email],
      subject: `${sessionName} - your private link`,
      html: `
        <div style="font-family: Inter, Arial, sans-serif; color: #111827; line-height: 1.6;">
          <h1 style="margin: 0 0 16px; font-size: 24px; color: #1a1a2e;">Your session link</h1>
          <p style="margin: 0 0 16px;">Click below to open your Diagonal Thinking session resources.</p>
          <p style="margin: 24px 0;">
            <a href="${verifyUrl.toString()}" style="display:inline-block;background:#111111;color:#ffffff;padding:12px 18px;text-decoration:none;border-radius:6px;font-weight:600;">
              Open session
            </a>
          </p>
          <p style="margin: 16px 0 0; font-size: 14px; color: #6b7280;">If the button does not work, use this link:</p>
          <p style="word-break: break-all; font-size: 14px; color: #3B5CB5;">${verifyUrl.toString()}</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || data?.error || "Unable to send magic link.");
  }

  return verifyUrl.toString();
}

async function fetchResourcesBySession(supabase, sessionIds) {
  if (!sessionIds.length) return [];

  const { data, error } = await supabase
    .from("resources")
    .select("*")
    .in("session_id", sessionIds)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

async function fetchEngagementBySession(supabase, sessionIds) {
  if (!sessionIds.length) return [];

  const { data, error } = await supabase
    .from("engagement_log")
    .select("*")
    .in("session_id", sessionIds)
    .order("occurred_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

async function fetchContactsByIds(supabase, contactIds) {
  if (!contactIds.length) return [];

  const { data, error } = await supabase
    .from("contacts")
    .select("id, company, contact_name, email")
    .in("id", contactIds);

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

export async function listSessionDetails(supabase) {
  const { data: sessions, error } = await supabase
    .from("sessions")
    .select("*")
    .order("date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const sessionRows = sessions || [];
  const sessionIds = sessionRows.map((session) => session.id);
  const resources = await fetchResourcesBySession(supabase, sessionIds);
  const engagementLog = await fetchEngagementBySession(supabase, sessionIds);

  const contactIds = Array.from(
    new Set(
      [
        ...sessionRows.map((row) => row.organisation_id).filter(Boolean),
        ...engagementLog.map((row) => row.contact_id).filter(Boolean),
      ],
    ),
  );
  const contacts = await fetchContactsByIds(supabase, contactIds);
  const contactMap = new Map(contacts.map((contact) => [contact.id, contact]));
  const resourceMap = new Map(resources.map((resource) => [resource.id, resource]));

  return sessionRows.map((row) => {
    const state = decodeSessionState(row.status);
    const sessionResources = resources
      .filter((resource) => resource.session_id === row.id)
      .map((resource) => ({
        id: resource.id,
        label: resource.label || "",
        type: resource.type || "link",
        url: resource.url || "",
        sortOrder: resource.sort_order ?? 0,
      }));
    const sessionEvents = engagementLog.filter((entry) => entry.session_id === row.id);
    const registrations = sessionEvents
      .filter((entry) => entry.event_type === "resource_click" && !entry.resource_id)
      .map((entry) => {
        const contact = contactMap.get(entry.contact_id);
        return {
          id: entry.id,
          contactId: entry.contact_id,
          name: contact?.contact_name || "",
          email: contact?.email || "",
          company: contact?.company || "",
          registeredAt: formatTimestamp(entry.occurred_at),
        };
      });
    const activity = sessionEvents
      .filter((entry) => !(entry.event_type === "resource_click" && !entry.resource_id))
      .map((entry) => {
      const contact = contactMap.get(entry.contact_id);
      const resource = resourceMap.get(entry.resource_id);
      return {
        id: entry.id,
        contactId: entry.contact_id || "",
        eventType: entry.event_type || "activity",
        occurredAt: formatTimestamp(entry.occurred_at),
        occurredAtRaw: entry.occurred_at || "",
        contactName: contact?.contact_name || "",
        email: contact?.email || "",
        company: contact?.company || "",
        resourceLabel: resource?.label || "",
        resourceId: entry.resource_id || "",
      };
    });

    return {
      id: row.id,
      name: row.name || "",
      slug: row.slug || "",
      organisationId: row.organisation_id || "",
      organisationName: contactMap.get(row.organisation_id)?.company || "",
      date: row.date || "",
      status: state.status,
      sessionType: inferSessionType(row),
      resources: sessionResources,
      resourceCount: sessionResources.length,
      registrations,
      engagementLog: activity,
    };
  });
}

async function uniqueSlug(supabase, baseSlug, existingId) {
  let candidate = baseSlug;
  let suffix = 2;

  while (true) {
    const { data } = await supabase
      .from("sessions")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();

    // No collision, or collision is the session we're currently editing
    if (!data || (existingId && data.id === existingId)) {
      return candidate;
    }

    candidate = `${baseSlug}-${suffix}`;
    suffix++;
  }
}

export async function saveSessionDetails(supabase, payload) {
  const name = String(payload.name || "").trim();
  const baseSlug = slugify(payload.slug || payload.name);
  const sessionType = payload.sessionType === "open_event" ? "open_event" : "in_house";
  const status = payload.status === "inactive" ? "inactive" : "active";
  const organisationId = payload.organisationId || null;
  const date = payload.date || null;

  if (!name) {
    throw new Error("Session name is required.");
  }

  if (!baseSlug) {
    throw new Error("Session slug is required.");
  }

  if (sessionType === "in_house" && !organisationId) {
    throw new Error("In-house sessions must be linked to an organisation.");
  }

  const slug = await uniqueSlug(supabase, baseSlug, payload.id || null);

  const resourceRows = Array.isArray(payload.resources)
    ? payload.resources
        .map((resource, index) => ({
          label: String(resource.label || "").trim(),
          type: String(resource.type || "link").trim().toLowerCase(),
          url: String(resource.url || "").trim(),
          sort_order: Number(resource.sortOrder ?? index),
        }))
        .filter((resource) => resource.label && resource.url)
    : [];

  if (!resourceRows.length) {
    throw new Error("Add at least one resource before saving.");
  }

  const row = {
    name,
    slug,
    organisation_id: sessionType === "open_event" ? null : organisationId,
    date,
    status: encodeSessionState(status, sessionType),
  };

  let sessionId = payload.id || null;

  if (sessionId) {
    const { error: updateError } = await supabase.from("sessions").update(row).eq("id", sessionId);
    if (updateError) {
      throw new Error(updateError.message);
    }
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from("sessions")
      .insert(row)
      .select("id")
      .single();
    if (insertError) {
      throw new Error(insertError.message);
    }
    sessionId = inserted.id;
  }

  const { error: deleteResourcesError } = await supabase
    .from("resources")
    .delete()
    .eq("session_id", sessionId);
  if (deleteResourcesError) {
    throw new Error(deleteResourcesError.message);
  }

  const { error: insertResourcesError } = await supabase.from("resources").insert(
    resourceRows.map((resource) => ({
      session_id: sessionId,
      label: resource.label,
      type: resource.type,
      url: resource.url,
      sort_order: resource.sort_order,
    })),
  );
  if (insertResourcesError) {
    throw new Error(insertResourcesError.message);
  }

  const sessions = await listSessionDetails(supabase);
  return sessions.find((session) => session.id === sessionId) || null;
}
