import { prisma } from "@e2r/shared";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { POST as createProjectRoute } from "@/app/api/projects/route";
import { PUT as putListingRoute } from "@/app/api/projects/[id]/listing/route";
import { POST as uploadPhotoRoute } from "@/app/api/projects/[id]/photos/route";
import { POST as rightsRoute } from "@/app/api/projects/[id]/rights/route";
import { POST as proposeShotsRoute } from "@/app/api/projects/[id]/shots/route";
import {
  cleanupTestContext,
  createTestContext,
  jsonRequest,
  params,
  testImage,
  uploadRequest,
  VALID_LISTING,
  type TestContext,
} from "../helpers";

/** End-to-End über die Route-Handler: manuelles Projekt anlegen. */

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await cleanupTestContext(ctx);
});

describe("Manuelle Projekterstellung", () => {
  let projectId: string;

  test("ohne Session → 401", async () => {
    const response = await createProjectRoute(
      jsonRequest("/api/projects", "POST", null, {
        title: "Unautorisiert",
      })
    );
    expect(response.status).toBe(401);
  });

  test("legt Projekt als Entwurf an", async () => {
    const response = await createProjectRoute(
      jsonRequest("/api/projects", "POST", ctx, {
        title: "Integrationstest-Wohnung",
        sourceType: "MANUAL_UPLOAD",
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    projectId = body.data.id;
    expect(body.data.status).toBe("DRAFT");
  });

  test("API-Quelle ohne Konfiguration → 501", async () => {
    const response = await createProjectRoute(
      jsonRequest("/api/projects", "POST", ctx, {
        title: "API-Import-Versuch",
        sourceType: "IMMOSCOUT24_API",
      })
    );
    expect(response.status).toBe(501);
  });

  test("speichert Exposé-Daten (Miete)", async () => {
    const response = await putListingRoute(
      jsonRequest(`/api/projects/${projectId}/listing`, "PUT", ctx, VALID_LISTING),
      params({ id: projectId })
    );
    expect(response.status).toBe(200);
  });

  test("lehnt Miete ohne Kaltmiete ab", async () => {
    const { kaltmiete: _kaltmiete, ...invalid } = VALID_LISTING;
    const response = await putListingRoute(
      jsonRequest(`/api/projects/${projectId}/listing`, "PUT", ctx, invalid),
      params({ id: projectId })
    );
    expect(response.status).toBe(422);
  });

  test("Foto-Upload mit automatischem Label-Vorschlag", async () => {
    const image = testImage(1);
    const response = await uploadPhotoRoute(
      uploadRequest(`/api/projects/${projectId}/photos`, ctx, {
        buffer: image.buffer,
        filename: "wohnzimmer-hell.png",
        mimeType: "image/png",
      }),
      params({ id: projectId })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.roomLabel).toBe("WOHNZIMMER");
    expect(body.data.sha256).toHaveLength(64);
  });

  test("Rechte-Bestätigung schaltet Projekt auf „Prüfung nötig“", async () => {
    const response = await rightsRoute(
      jsonRequest(`/api/projects/${projectId}/rights`, "POST", ctx, {
        scope: "Alle Fotos",
        sourceDescription: "Eigene Testaufnahmen",
        confirmed: true,
      }),
      params({ id: projectId })
    );
    expect(response.status).toBe(201);
    const project = await prisma.propertyProject.findUnique({
      where: { id: projectId },
    });
    expect(project?.status).toBe("NEEDS_REVIEW");
  });

  test("Shotlisten-Vorschlag erzeugt Shots mit Leitplanken-Prompt", async () => {
    const response = await proposeShotsRoute(
      jsonRequest(`/api/projects/${projectId}/shots`, "POST", ctx),
      params({ id: projectId })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data[0].prompt).toContain("Do not add");
  });

  test("fremde Organisation sieht das Projekt nicht", async () => {
    const stranger = await createTestContext();
    try {
      const response = await putListingRoute(
        jsonRequest(`/api/projects/${projectId}/listing`, "PUT", stranger, VALID_LISTING),
        params({ id: projectId })
      );
      expect(response.status).toBe(404);
    } finally {
      await cleanupTestContext(stranger);
    }
  });
});
