import { randomUUID } from "node:crypto";
import { hashPassword, prisma } from "@e2r/shared";
import { encodeSession, SESSION_COOKIE } from "@/server/session";
import {
  roomImage,
  type SeedImage,
} from "../../../packages/shared/prisma/seedImages";

/** Gemeinsame Helfer für die Integrationstests der Web-App. */

export interface TestContext {
  organizationId: string;
  userId: string;
  cookie: string;
}

export async function createTestContext(): Promise<TestContext> {
  const organization = await prisma.organization.create({
    data: { name: `Test-Org ${randomUUID()}` },
  });
  const user = await prisma.user.create({
    data: {
      email: `test-${randomUUID()}@example.com`,
      name: "Testnutzer",
      passwordHash: hashPassword("test1234"),
      organizationId: organization.id,
    },
  });
  return {
    organizationId: organization.id,
    userId: user.id,
    cookie: `${SESSION_COOKIE}=${encodeSession(user.id)}`,
  };
}

export async function cleanupTestContext(ctx: TestContext): Promise<void> {
  await prisma.auditEvent.deleteMany({
    where: { organizationId: ctx.organizationId },
  });
  await prisma.propertyProject.deleteMany({
    where: { organizationId: ctx.organizationId },
  });
  await prisma.user.deleteMany({
    where: { organizationId: ctx.organizationId },
  });
  await prisma.organization.delete({ where: { id: ctx.organizationId } });
}

export function jsonRequest(
  url: string,
  method: string,
  ctx: TestContext | null,
  payload?: unknown,
  extraHeaders: Record<string, string> = {}
): Request {
  return new Request(`http://localhost:3000${url}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(ctx ? { cookie: ctx.cookie } : {}),
      ...extraHeaders,
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

export function uploadRequest(
  url: string,
  ctx: TestContext,
  file: { buffer: Buffer; filename: string; mimeType: string }
): Request {
  const form = new FormData();
  form.append(
    "file",
    new File([new Uint8Array(file.buffer)], file.filename, { type: file.mimeType })
  );
  return new Request(`http://localhost:3000${url}`, {
    method: "POST",
    headers: { cookie: ctx.cookie },
    body: form,
  });
}

export function params<T extends Record<string, string>>(value: T) {
  return { params: Promise.resolve(value) };
}

export function testImage(seed = 1): SeedImage {
  return roomImage([255, 183, 77], [255, 236, 179], seed, 1280, 854);
}

export const VALID_LISTING = {
  marketingType: "MIETE",
  objectType: "Wohnung",
  titel: "Testwohnung mit Balkon in Leipzig",
  plz: "04155",
  ort: "Leipzig",
  addressVisibility: "CITY_ONLY",
  kaltmiete: 890,
  zimmer: 3,
  wohnflaeche: 84.5,
};
