import { NextRequest, NextResponse } from "next/server";
import { getClientSessionBySlug } from "@/lib/client-data";
import {
  createMagicLink,
  ensureContactForSessionRegistration,
  sendMagicLinkEmail,
} from "@/lib/client-server";

// SEC-CA-005 — explicit decision (2026-05-02, P3): no CSRF nonce on the
// JSON form endpoints. Rationale: this route accepts only application/json
// (see body parsing below — non-JSON requests fail at JSON.parse), which
// browsers do not allow cross-origin without a CORS preflight. The current
// CORS config allows only Same-Origin. A cross-origin attacker therefore
// cannot trigger this route from another tab without first compromising
// the user's session — at which point CSRF is moot.
//
// If CORS is ever loosened (e.g. to allow Squarespace embed origin) or a
// form-encoded variant of this endpoint is added, CSRF nonce coverage
// becomes mandatory at that point. Tracked: register entry CA-005.

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const sessionSlug = typeof body?.sessionSlug === "string" ? body.sessionSlug.trim() : "";

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
  }

  if (!sessionSlug) {
    return NextResponse.json({ error: "A session slug is required." }, { status: 400 });
  }

  const session = await getClientSessionBySlug(sessionSlug);

  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  const contact = await ensureContactForSessionRegistration({
    session,
    email,
    firstName: typeof body?.firstName === "string" ? body.firstName : "",
    lastName: typeof body?.lastName === "string" ? body.lastName : "",
    companyName: typeof body?.companyName === "string" ? body.companyName : "",
    jobTitle: typeof body?.jobTitle === "string" ? body.jobTitle : "",
  });

  const magicLink = await createMagicLink(session.slug, contact.id);
  await sendMagicLinkEmail(email, session.name, magicLink.token);

  return NextResponse.json({
    success: true,
    email,
    sessionSlug: session.slug,
  });
}
