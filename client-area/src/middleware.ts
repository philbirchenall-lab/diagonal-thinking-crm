import { NextRequest, NextResponse } from "next/server";
import { CLIENT_SESSION_COOKIE, verifyClientSessionToken } from "@/lib/auth";

function buildStartUrl(request: NextRequest, slug: string) {
  const url = request.nextUrl.clone();
  url.pathname = "/";
  url.search = "";
  if (slug) {
    url.searchParams.set("session", slug);
  }
  return url;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/session/")) {
    return NextResponse.next();
  }

  const token = request.cookies.get(CLIENT_SESSION_COOKIE)?.value;
  const requestedSlug = pathname.split("/").filter(Boolean)[1] ?? "";

  if (!token) {
    return NextResponse.redirect(buildStartUrl(request, requestedSlug));
  }

  try {
    const payload = await verifyClientSessionToken(token);

    if (payload.sessionSlug && requestedSlug && payload.sessionSlug !== requestedSlug) {
      return NextResponse.redirect(buildStartUrl(request, requestedSlug));
    }

    return NextResponse.next();
  } catch {
    return NextResponse.redirect(buildStartUrl(request, requestedSlug));
  }
}

export const config = {
  matcher: ["/session/:path*"],
};
