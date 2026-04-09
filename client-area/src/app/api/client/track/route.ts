import { NextRequest, NextResponse } from "next/server";
import {
  CLIENT_SESSION_COOKIE,
  readSessionCookie,
} from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const cookieStore = request.cookies;
  const sessionToken = cookieStore.get(CLIENT_SESSION_COOKIE)?.value;

  if (!sessionToken) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const session = await readSessionCookie(cookieStore);

  if (!session) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const sessionSlug = typeof body?.sessionSlug === "string" ? body.sessionSlug.trim() : "";
  const resourceId = typeof body?.resourceId === "string" ? body.resourceId.trim() : "";

  if (!sessionSlug || sessionSlug !== session.sessionSlug) {
    return NextResponse.json({ error: "Session mismatch." }, { status: 403 });
  }

  try {
    const supabase = createServiceClient();
    await supabase.from("engagement_log").insert({
      contact_id: session.contactId,
      session_id: session.sessionId,
      resource_id: resourceId || null,
      event_type: "resource_click",
      occurred_at: new Date().toISOString(),
    });
  } catch {
    // Tracking is best-effort so the page never blocks the client.
  }

  return NextResponse.json({ success: true });
}
