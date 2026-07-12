import { hmacSign, hmacVerify, prisma } from "@e2r/shared";
import { cookies } from "next/headers";

/**
 * Minimaler, signierter Session-Cookie (HMAC-SHA256). Enthält nur die
 * User-ID + Ablaufzeit — keine personenbezogenen Daten im Klartext-Payload
 * über das Nötigste hinaus, keine Secrets.
 */

export const SESSION_COOKIE = "e2r_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 Stunden

interface SessionPayload {
  userId: string;
  exp: number;
}

export function encodeSession(userId: string): string {
  const payload: SessionPayload = {
    userId,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmacSign(`session:${body}`)}`;
}

export function decodeSession(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  if (!hmacVerify(`session:${body}`, signature)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8")
    ) as SessionPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  organizationId: string;
  organizationName: string;
}

/** Aktueller Nutzer inkl. Organisation, oder null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const payload = decodeSession(store.get(SESSION_COOKIE)?.value);
  if (!payload) return null;
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    include: { organization: true },
  });
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    organizationId: user.organizationId,
    organizationName: user.organization.name,
  };
}

/** Session aus einem Request lesen (für Route-Handler/Integrationstests). */
export async function getSessionUserFromRequest(
  request: Request
): Promise<SessionUser | null> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  const payload = decodeSession(match?.slice(SESSION_COOKIE.length + 1));
  if (!payload) return null;
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    include: { organization: true },
  });
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    organizationId: user.organizationId,
    organizationName: user.organization.name,
  };
}
