import { NextRequest, NextResponse } from "next/server";
import { CLIENT_SESSION_COOKIE } from "@/lib/auth";

export function GET(request: NextRequest) {
  const session = request.nextUrl.searchParams.get("session");
  const redirectUrl = new URL("/", request.url);

  if (session) {
    redirectUrl.searchParams.set("session", session);
  }

  const response = NextResponse.redirect(redirectUrl);

  response.cookies.set(CLIENT_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 0,
  });

  return response;
}
