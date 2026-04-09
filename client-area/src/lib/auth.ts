import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export const CLIENT_SESSION_COOKIE = "dt_client_session";
export const SESSION_TTL = "30d";

export type ClientSessionToken = JWTPayload & {
  contactId: string;
  sessionId: string;
  email: string;
  sessionSlug: string;
  sessionName?: string;
};

type CookieStoreLike = {
  get(name: string): { value?: string } | undefined;
};

function getSecretKey() {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET is not set.");
  }

  return new TextEncoder().encode(secret);
}

export async function signClientSessionToken(payload: ClientSessionToken) {
  return new SignJWT({
    contactId: payload.contactId,
    sessionId: payload.sessionId,
    email: payload.email,
    sessionSlug: payload.sessionSlug,
    sessionName: payload.sessionName,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(getSecretKey());
}

export async function verifyClientSessionToken(token: string) {
  const { payload } = await jwtVerify(token, getSecretKey());
  return payload as ClientSessionToken;
}

export async function readSessionCookie(cookies: CookieStoreLike) {
  const token = cookies.get(CLIENT_SESSION_COOKIE)?.value;

  if (!token) {
    return null;
  }

  try {
    return await verifyClientSessionToken(token);
  } catch {
    return null;
  }
}
