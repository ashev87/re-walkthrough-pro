import { CAMERA_MOVES, prisma } from "@e2r/shared";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { POST as createProjectRoute } from "@/app/api/projects/route";
import { POST as uploadPhotoRoute } from "@/app/api/projects/[id]/photos/route";
import {
  PATCH as patchShotsRoute,
  POST as proposeShotsRoute,
} from "@/app/api/projects/[id]/shots/route";
import {
  cleanupTestContext,
  createTestContext,
  jsonRequest,
  params,
  testImage,
  uploadRequest,
  type TestContext,
} from "../helpers";

/** Shot-Einzeländerungen: Kamerabewegung überschreiben, Raum-Label-Reset. */

let ctx: TestContext;
let projectId: string;
let shotId: string;

beforeAll(async () => {
  ctx = await createTestContext();
  const created = await createProjectRoute(
    jsonRequest("/api/projects", "POST", ctx, {
      title: "Shot-Update-Test",
      sourceType: "MANUAL_UPLOAD",
    })
  );
  expect(created.status).toBe(201);
  projectId = (await created.json()).data.id;

  const image = testImage(7);
  const uploaded = await uploadPhotoRoute(
    uploadRequest(`/api/projects/${projectId}/photos`, ctx, {
      buffer: image.buffer,
      filename: "wohnzimmer-shot-test.png",
      mimeType: "image/png",
    }),
    params({ id: projectId })
  );
  expect(uploaded.status).toBe(201);

  const proposed = await proposeShotsRoute(
    jsonRequest(`/api/projects/${projectId}/shots`, "POST", ctx),
    params({ id: projectId })
  );
  expect(proposed.status).toBe(201);
  shotId = (await proposed.json()).data[0].id;
});

afterAll(async () => {
  await cleanupTestContext(ctx);
});

describe("PATCH /shots — Kamerabewegung", () => {
  test("setzt die Kamerabewegung und baut den Prompt mit der Instruktion neu", async () => {
    const response = await patchShotsRoute(
      jsonRequest(`/api/projects/${projectId}/shots`, "PATCH", ctx, {
        updates: [{ id: shotId, cameraMove: "still" }],
      }),
      params({ id: projectId })
    );
    expect(response.status).toBe(200);

    const shot = await prisma.shot.findUniqueOrThrow({ where: { id: shotId } });
    expect(shot.cameraMove).toBe("still");
    expect(shot.prompt).toContain(CAMERA_MOVES.still!.instruction);
  });

  test("Raum-Label-Wechsel setzt die Bewegung auf den Raum-Standard zurück", async () => {
    const response = await patchShotsRoute(
      jsonRequest(`/api/projects/${projectId}/shots`, "PATCH", ctx, {
        updates: [{ id: shotId, roomLabel: "KUECHE" }],
      }),
      params({ id: projectId })
    );
    expect(response.status).toBe(200);

    const shot = await prisma.shot.findUniqueOrThrow({ where: { id: shotId } });
    expect(shot.roomLabel).toBe("KUECHE");
    // Küche → Standard „lateral“ inkl. neuem Prompt.
    expect(shot.cameraMove).toBe("lateral");
    expect(shot.prompt).toContain(CAMERA_MOVES.lateral!.instruction);
  });

  test("unbekannte Kamerabewegung wird abgelehnt (422)", async () => {
    const response = await patchShotsRoute(
      jsonRequest(`/api/projects/${projectId}/shots`, "PATCH", ctx, {
        updates: [{ id: shotId, cameraMove: "wackelig" }],
      }),
      params({ id: projectId })
    );
    expect(response.status).toBe(422);
  });
});
