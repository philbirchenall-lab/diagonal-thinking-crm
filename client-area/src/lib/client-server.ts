import crypto from "node:crypto";
import { createServiceClient } from "@/lib/supabase";
import type { ClientSession } from "@/lib/client-data";

const DEFAULT_CLIENT_AREA_ORIGIN = "https://client.diagonalthinking.co";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function buildContactName(firstName: string, lastName: string) {
  return [firstName, lastName].map((value) => value.trim()).filter(Boolean).join(" ");
}

function setJobTitleInNotes(notes: string | null, jobTitle: string) {
  const cleanTitle = jobTitle.trim();
  if (!cleanTitle) return notes ?? "";

  const lines = String(notes ?? "")
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

export async function ensureContactForSessionRegistration(payload: {
  session: ClientSession;
  email: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  jobTitle?: string;
}) {
  const supabase = createServiceClient();
  const email = normalizeEmail(payload.email);
  const firstName = payload.firstName?.trim() ?? "";
  const lastName = payload.lastName?.trim() ?? "";
  const companyName = payload.companyName?.trim() ?? "";
  const jobTitle = payload.jobTitle?.trim() ?? "";
  const contactName = buildContactName(firstName, lastName);
  const resolvedCompany =
    payload.session.sessionType === "in_house"
      ? payload.session.organisationName ?? companyName
      : companyName || payload.session.organisationName || "";

  const { data: existingContact, error: lookupError } = await supabase
    .from("contacts")
    .select("*")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();

  if (lookupError) {
    throw new Error(lookupError.message);
  }

  if (existingContact) {
    const updates: Record<string, unknown> = {};

    if (contactName && existingContact.contact_name !== contactName) {
      updates.contact_name = contactName;
    }

    if (resolvedCompany && !existingContact.company) {
      updates.company = resolvedCompany;
    }

    if (jobTitle) {
      const nextNotes = setJobTitleInNotes(existingContact.notes, jobTitle);
      if (nextNotes !== String(existingContact.notes ?? "")) {
        updates.notes = nextNotes;
      }
    }

    // Write organisation_id if session has one and contact doesn't yet
    if (payload.session.organisationId && !existingContact.organisation_id) {
      updates.organisation_id = payload.session.organisationId;
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

  const { data: insertedContact, error: insertError } = await supabase
    .from("contacts")
    .insert({
      company: resolvedCompany || null,
      contact_name: contactName || null,
      email,
      phone: null,
      type: "Mailing List",
      services: [],
      projected_value: 0,
      notes: jobTitle ? setJobTitleInNotes("", jobTitle) : null,
      source: "Manual",
      network_partner: false,
      organisation_id: payload.session.organisationId ?? null,
    })
    .select("*")
    .single();

  if (insertError) {
    throw new Error(insertError.message);
  }

  return insertedContact;
}

export async function logRegistrationIfNeeded(sessionId: string, contactId: string) {
  const supabase = createServiceClient();

  const { data: existingRow, error: lookupError } = await supabase
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

  if (existingRow) {
    return existingRow;
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

export async function createMagicLink(sessionSlug: string, contactId: string) {
  const supabase = createServiceClient();
  const token = `${crypto.randomUUID()}-${crypto.randomBytes(18).toString("hex")}`;

  const { data, error } = await supabase
    .from("magic_links")
    .insert({
      contact_id: contactId,
      session_slug: sessionSlug,
      token,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      used_at: null,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function sendMagicLinkEmail(email: string, sessionName: string, token: string) {
  const resendKey = process.env.RESEND_API_KEY;

  if (!resendKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  const origin = process.env.CLIENT_AREA_ORIGIN || DEFAULT_CLIENT_AREA_ORIGIN;
  const verifyUrl = new URL("/verify", origin);
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
      subject: `${sessionName} - your access link`,
      html: `
        <div style="font-family: 'Source Sans 3', Arial, sans-serif; color: #111111; line-height: 1.6;">
          <p style="margin: 0 0 12px; font-size: 13px; letter-spacing: 0.18em; text-transform: uppercase; color: #305DAB; font-weight: 600;">Client Area</p>
          <h1 style="margin: 0 0 16px; font-family: Oswald, 'Arial Narrow', sans-serif; font-size: 28px; line-height: 1.1; letter-spacing: 0.02em; text-transform: uppercase; color: #305DAB;">Your session link</h1>
          <p style="margin: 0 0 16px;">Click below to open your Diagonal Thinking session resources.</p>
          <p style="margin: 24px 0;">
            <a href="${verifyUrl.toString()}" style="display:inline-block;background:#305DAB;color:#ffffff;padding:12px 18px;text-decoration:none;border-radius:8px;font-weight:600;">
              Open session
            </a>
          </p>
          <p style="margin: 16px 0 0; font-size: 14px; color: #6b7280;">If the button does not work, use this link:</p>
          <p style="word-break: break-all; font-size: 14px; color: #305DAB;">${verifyUrl.toString()}</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message ?? data?.error ?? "Unable to send access link.");
  }

  return verifyUrl.toString();
}

export async function getMagicLinkRecord(token: string) {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("magic_links")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function markMagicLinkUsed(id: string) {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("magic_links")
    .update({ used_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function getContactById(id: string) {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("contacts")
    .select("id, email, contact_name, company")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}
