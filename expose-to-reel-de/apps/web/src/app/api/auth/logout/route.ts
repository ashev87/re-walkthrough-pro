import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/server/session";

export function POST(): NextResponse {
  const response = NextResponse.json({ ok: true, data: null });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
