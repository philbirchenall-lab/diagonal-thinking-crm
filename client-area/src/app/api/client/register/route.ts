import { NextRequest, NextResponse } from "next/server";
import { getClientSessionBySlug } from "@/lib/client-data";
import {
  ensureContactForSessionRegistration,
  logRegistrationIfNeeded,
} from "@/lib/client-server";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const sessionSlug = typeof body?.sessionSlug === "string" ? body.sessionSlug.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const firstName = typeof body?.firstName === "string" ? body.firstName.trim() : "";
  const lastName = typeof body?.lastName === "string" ? body.lastName.trim() : "";
  const companyName = typeof body?.companyName === "string" ? body.companyName.trim() : "";
  const jobTitle = typeof body?.jobTitle === "string" ? body.jobTitle.trim() : "";

  if (!sessionSlug) {
    return NextResponse.json({ error: "A session slug is required." }, { status: 400 });
  }

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
  }

  if (!firstName || !lastName) {
    return NextResponse.json(
      { error: "First name and last name are required." },
      { status: 400 },
    );
  }

  const session = await getClientSessionBySlug(sessionSlug);

  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  if (session.sessionType === "open_event" && !companyName) {
    return NextResponse.json(
      { error: "Company name is required for open events." },
      { status: 400 },
    );
  }

  const contact = await ensureContactForSessionRegistration({
    session,
    email,
    firstName,
    lastName,
    companyName,
    jobTitle,
  });

  await logRegistrationIfNeeded(session.id, contact.id);

  return NextResponse.json({
    success: true,
    email,
    sessionSlug,
    contactId: contact.id,
  });
}
