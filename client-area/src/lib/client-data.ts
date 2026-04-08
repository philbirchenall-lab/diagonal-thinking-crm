import { createServiceClient } from "@/lib/supabase";

const SESSION_STATE_SEPARATOR = "::";

export type SessionType = "in_house" | "open_event";
export type SessionStatus = "active" | "inactive";
export type SessionResourceType = "link" | "file" | "embed" | string;

export type SessionResource = {
  id: string;
  label: string;
  type: SessionResourceType;
  url: string;
  sortOrder: number;
};

export type ClientSession = {
  id: string;
  slug: string;
  name: string;
  organisationId: string | null;
  organisationName: string | null;
  date: string | null;
  status: SessionStatus;
  sessionType: SessionType;
  resources: SessionResource[];
  resourceCount?: number;
};

function pickString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function decodeSessionState(rawValue: unknown) {
  const raw = String(rawValue || "active").trim();
  const [status, sessionType] = raw.split(SESSION_STATE_SEPARATOR);

  return {
    status: status === "inactive" ? "inactive" : "active",
    sessionType: sessionType === "open_event" ? "open_event" : "in_house",
  } satisfies { status: SessionStatus; sessionType: SessionType };
}

function inferSessionType(row: Record<string, unknown>) {
  const explicitType = pickString(row, "session_type");
  if (explicitType === "open_event" || explicitType === "in_house") {
    return explicitType;
  }

  const rawStatus = String(row.status ?? "");
  if (rawStatus.includes(SESSION_STATE_SEPARATOR)) {
    return decodeSessionState(rawStatus).sessionType;
  }

  return pickString(row, "organisation_id") ? "in_house" : "open_event";
}

function normalizeResource(row: Record<string, unknown>): SessionResource {
  return {
    id: String(row.id),
    label: pickString(row, "label") ?? "Resource",
    type: pickString(row, "type") ?? "link",
    url: pickString(row, "url") ?? "#",
    sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0),
  };
}

async function resolveOrganisationName(organisationId: string | null) {
  if (!organisationId) return null;

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("contacts")
    .select("company")
    .eq("id", organisationId)
    .maybeSingle();

  return data?.company ?? null;
}

function normalizeSession(
  row: Record<string, unknown>,
  resources: SessionResource[],
  organisationName: string | null,
): ClientSession {
  const state = decodeSessionState(row.status);

  return {
    id: String(row.id),
    slug: pickString(row, "slug") ?? String(row.id),
    name: pickString(row, "name") ?? "Client session",
    organisationId: pickString(row, "organisation_id"),
    organisationName,
    date: pickString(row, "date"),
    status: state.status,
    sessionType: inferSessionType(row),
    resources,
  };
}

// Slugs reserved for internal test data — never exposed to clients.
const TEST_SLUGS = new Set(["test"]);

export async function getClientSessionBySlug(slug: string) {
  if (TEST_SLUGS.has(slug.toLowerCase())) {
    return null;
  }

  const supabase = createServiceClient();

  const { data: session, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !session) {
    return null;
  }

  const state = decodeSessionState(session.status);
  if (state.status !== "active") {
    return null;
  }

  const { data: resourceRows } = await supabase
    .from("resources")
    .select("*")
    .eq("session_id", session.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const resources = (resourceRows ?? []).map((row) => normalizeResource(row as Record<string, unknown>));
  const organisationName = await resolveOrganisationName(
    typeof session.organisation_id === "string" ? session.organisation_id : null,
  );

  return normalizeSession(session as Record<string, unknown>, resources, organisationName);
}

export async function listClientSessions() {
  const supabase = createServiceClient();

  const { data: sessionRows, error } = await supabase
    .from("sessions")
    .select("*")
    .order("date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error || !sessionRows) {
    return [];
  }

  const sessions = await Promise.all(
    sessionRows.map(async (row) => {
      const { data: resourceRows } = await supabase
        .from("resources")
        .select("id")
        .eq("session_id", row.id);

      const organisationName = await resolveOrganisationName(
        typeof row.organisation_id === "string" ? row.organisation_id : null,
      );

      const session = normalizeSession(row as Record<string, unknown>, [], organisationName);

      return {
        ...session,
        resourceCount: resourceRows?.length ?? 0,
      };
    }),
  );

  return sessions;
}

export function formatSessionDate(value: string | null) {
  if (!value) {
    return "TBC";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}
