import { NextRequest, NextResponse } from "next/server";
import { CLIENT_SESSION_COOKIE, readSessionCookie } from "@/lib/auth";
import { getClientSessionBySlug } from "@/lib/client-data";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const cookieStore = request.cookies;
  const sessionToken = cookieStore.get(CLIENT_SESSION_COOKIE)?.value;

  if (!sessionToken) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const authedSession = await readSessionCookie(cookieStore);

  if (!authedSession?.sessionSlug) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const { slug } = await params;

  if (authedSession.sessionSlug !== slug) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  const session = await getClientSessionBySlug(slug);

  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  return NextResponse.json({ session });
}
