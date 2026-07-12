import { prisma } from "@e2r/shared";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { POST as createProjectRoute } from "@/app/api/projects/route";
import { POST as uploadPhotoRoute } from "@/app/api/projects/[id]/photos/route";
import { encodePng } from "../../../../packages/shared/prisma/seedImages";
import {
  cleanupTestContext,
  createTestContext,
  jsonRequest,
  params,
  testImage,
  uploadRequest,
  type TestContext,
} from "../helpers";

/** Upload-Validierung: Typ, Größe, Abmessungen, Magic Bytes. */

let ctx: TestContext;
let projectId: string;

beforeAll(async () => {
  ctx = await createTestContext();
  const response = await createProjectRoute(
    jsonRequest("/api/projects", "POST", ctx, { title: "Upload-Validierung" })
  );
  projectId = (await response.json()).data.id;
});

afterAll(async () => {
  await cleanupTestContext(ctx);
});

function upload(file: { buffer: Buffer; filename: string; mimeType: string }) {
  return uploadPhotoRoute(
    uploadRequest(`/api/projects/${projectId}/photos`, ctx, file),
    params({ id: projectId })
  );
}

describe("Upload-Validierung", () => {
  test("gültiges PNG wird akzeptiert", async () => {
    const image = testImage(2);
    const response = await upload({
      buffer: image.buffer,
      filename: "kueche.png",
      mimeType: "image/png",
    });
    expect(response.status).toBe(201);
  });

  test("nicht unterstützter Typ → 422", async () => {
    const response = await upload({
      buffer: Buffer.from("kein bild"),
      filename: "notiz.txt",
      mimeType: "text/plain",
    });
    expect(response.status).toBe(422);
  });

  test("Magic-Bytes ≠ deklarierter Typ → 422", async () => {
    const image = testImage(3); // PNG-Bytes …
    const response = await upload({
      buffer: image.buffer,
      filename: "getarnt.jpg",
      mimeType: "image/jpeg", // … aber als JPEG deklariert
    });
    expect(response.status).toBe(422);
  });

  test("kaputte Datei mit PNG-Header → 422", async () => {
    const broken = Buffer.concat([
      Buffer.from("89504e470d0a1a0a", "hex"),
      Buffer.from("garbage"),
    ]);
    const response = await upload({
      buffer: broken,
      filename: "kaputt.png",
      mimeType: "image/png",
    });
    expect(response.status).toBe(422);
  });

  test("zu kleine Abmessungen → 422", async () => {
    const tiny = encodePng(100, 100, () => [200, 200, 200]);
    const response = await upload({
      buffer: tiny,
      filename: "winzig.png",
      mimeType: "image/png",
    });
    expect(response.status).toBe(422);
  });

  test("zu große Datei → 413", async () => {
    const huge = Buffer.alloc(15 * 1024 * 1024 + 1, 0xab);
    const response = await upload({
      buffer: huge,
      filename: "riesig.png",
      mimeType: "image/png",
    });
    expect(response.status).toBe(413);
  });

  test("Upload im Status GENERATING → 409", async () => {
    await prisma.propertyProject.update({
      where: { id: projectId },
      data: { status: "GENERATING" },
    });
    const image = testImage(4);
    const response = await upload({
      buffer: image.buffer,
      filename: "spaet.png",
      mimeType: "image/png",
    });
    expect(response.status).toBe(409);
    await prisma.propertyProject.update({
      where: { id: projectId },
      data: { status: "DRAFT" },
    });
  });
});
