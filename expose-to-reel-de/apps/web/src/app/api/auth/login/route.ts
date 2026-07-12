import { prisma, verifyPassword } from "@e2r/shared";
import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, withApi } from "@/server/api";
import { checkRateLimit } from "@/server/rateLimit";
import { encodeSession, SESSION_COOKIE } from "@/server/session";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const POST = withApi(async (request: Request) => {
  const limit = checkRateLimit(
    `login:${request.headers.get("x-forwarded-for") ?? "local"}`,
    10,
    60_000
  );
  if (!limit.allowed) {
    return jsonError("Zu viele Anmeldeversuche. Bitte kurz warten.", 429);
  }

  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("E-Mail und Passwort erforderlich.", 422);
  }
  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
  });
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    return jsonError("E-Mail oder Passwort ist falsch.", 401);
  }

  const response = NextResponse.json({ ok: true, data: { userId: user.id } });
  response.cookies.set(SESSION_COOKIE, encodeSession(user.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return response;
});
