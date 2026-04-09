import { NextRequest, NextResponse } from "next/server";
import {
  CLIENT_SESSION_COOKIE,
  signClientSessionToken,
} from "@/lib/auth";
import { getClientSessionBySlug } from "@/lib/client-data";
import {
  getContactById,
  getMagicLinkRecord,
  markMagicLinkUsed,
} from "@/lib/client-server";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Token is required." }, { status: 400 });
  }

  try {
    const linkRow = await getMagicLinkRecord(token);

    if (!linkRow) {
      return NextResponse.json({ error: "The access link is invalid or expired." }, { status: 401 });
    }

    const expiresAt = new Date(linkRow.expires_at);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      return NextResponse.json({ error: "The access link is invalid or expired." }, { status: 401 });
    }

    const session = await getClientSessionBySlug(linkRow.session_slug);
    const contact = await getContactById(linkRow.contact_id);

    if (!session || !contact?.email) {
      return NextResponse.json({ error: "The access link is invalid or expired." }, { status: 401 });
    }

    const sessionToken = await signClientSessionToken({
      contactId: contact.id,
      sessionId: session.id,
      email: contact.email,
      sessionSlug: session.slug,
      sessionName: session.name,
    });

    await markMagicLinkUsed(linkRow.id);

    const response = NextResponse.json({
      success: true,
      sessionSlug: session.slug,
    });

    response.cookies.set(CLIENT_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch {
    return NextResponse.json({ error: "The access link is invalid or expired." }, { status: 401 });
  }
}
