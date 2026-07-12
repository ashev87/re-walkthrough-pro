import { prisma } from "@e2r/shared";
import { NextResponse } from "next/server";
import { getSessionUserFromRequest, type SessionUser } from "./session";

/** Einheitliche JSON-Antworten + organisations-scoped Zugriffsprüfungen. */

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true, data }, init);
}

export function jsonError(
  message: string,
  status = 400,
  details?: unknown
): NextResponse {
  return NextResponse.json(
    { ok: false, error: message, details },
    { status }
  );
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Auth erzwingen; wirft ApiError(401). */
export async function requireUser(request: Request): Promise<SessionUser> {
  const user = await getSessionUserFromRequest(request);
  if (!user) throw new ApiError(401, "Nicht angemeldet.");
  return user;
}

/** Projekt laden und Organisation prüfen; wirft 404 bei fremden Projekten. */
export async function requireProject(user: SessionUser, projectId: string) {
  const project = await prisma.propertyProject.findFirst({
    where: { id: projectId, organizationId: user.organizationId },
  });
  if (!project) throw new ApiError(404, "Projekt nicht gefunden.");
  return project;
}

/** Handler-Wrapper: ApiError → JSON, Unerwartetes → 500 ohne Detail-Leak. */
export function withApi<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof ApiError) {
        return jsonError(error.message, error.status, error.details);
      }
      console.error("[api] Unerwarteter Fehler:", error);
      return jsonError("Interner Fehler. Bitte erneut versuchen.", 500);
    }
  };
}
