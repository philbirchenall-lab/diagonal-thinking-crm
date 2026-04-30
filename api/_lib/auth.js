/**
 * auth.js — server-side auth helper for CRM API routes.
 *
 * The CRM is a Vite SPA gated by Supabase Auth (see src/AuthWrapper.jsx).
 * Until 30 April 2026 the API routes under /api/client/*, /api/opportunities/*
 * and /api/admin/proposal-pdf/* trusted any caller and returned data using the
 * Supabase service-role key. Hex's risk register (30 Apr 2026, items API-001,
 * API-004, API-007, plus CA-002/CA-003) flagged this as a P0 leak class.
 *
 * This helper provides a single canonical check: a valid Supabase user JWT
 * must be presented as `Authorization: Bearer <access_token>`. The SPA grabs
 * the access token from the Supabase JS client session and attaches it to
 * every fetch against a gated route.
 *
 * Pattern parity:
 *   - Cron and Sol routes already use Authorization-header bearer auth
 *     (see api/proposal-followup-cron.js, api/sol/contacts.js).
 *   - The client-area Next.js app uses a `dt_client_session` JWT cookie.
 *     This CRM SPA is a different surface (Vite, no SSR, no Next.js
 *     middleware) and does not set HTTP cookies for its Supabase session,
 *     so cookie-based gating is not the right shape here.
 *
 * Returns the authenticated user object on success, or null on any failure.
 * Callers MUST treat null as "respond 401 and stop" — never proceed with a
 * service-role DB query when this returns null.
 */
export async function requireAuthedUser(req, supabaseAdmin) {
  try {
    const authHeader = req.headers?.authorization || req.headers?.Authorization || "";
    if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
      return null;
    }
    const token = authHeader.slice(7).trim();
    if (!token) {
      return null;
    }

    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) {
      return null;
    }
    return data.user;
  } catch {
    return null;
  }
}
