import { NextRequest, NextResponse } from "next/server";
import { CLIENT_SESSION_COOKIE, readSessionCookie } from "@/lib/auth";
import { listClientSessions } from "@/lib/client-data";

export async function GET(request: NextRequest) {
  const cookieStore = request.cookies;
  const sessionToken = cookieStore.get(CLIENT_SESSION_COOKIE)?.value;

  if (!sessionToken) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const session = await readSessionCookie(cookieStore);

  if (!session) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const sessions = await listClientSessions();

  return NextResponse.json({
    sessions,
  });
}
