import { getStorage, prisma, projectStorageKey, sha256Hex } from "@e2r/shared";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  DELETE as revokeApprovalRoute,
  POST as approveRoute,
} from "@/app/api/projects/[id]/approve/route";
import { POST as exportRoute } from "@/app/api/projects/[id]/export/route";
import {
  cleanupTestContext,
  createTestContext,
  jsonRequest,
  params,
  type TestContext,
} from "../helpers";

/** Freigabe-Gating: Export nur nach vollständiger Checkliste + Snapshot. */

let ctx: TestContext;
let projectId: string;

const FULL_CHECKLIST = {
  factsVerified: true,
  noMisleadingContent: true,
  imageRightsConfirmed: true,
  privacyReviewed: true,
  addressVisibilityConfirmed: true,
};

beforeAll(async () => {
  ctx = await createTestContext();
  const project = await prisma.propertyProject.create({
    data: {
      organizationId: ctx.organizationId,
      title: "Freigabe-Test",
      status: "READY",
      listingData: {
        create: {
          marketingType: "MIETE",
          objectType: "Wohnung",
          titel: "Freigabe-Test",
          plz: "04155",
          ort: "Leipzig",
          kaltmiete: 890,
        },
      },
      rightsAttestations: {
        create: {
          userId: ctx.userId,
          scope: "Alle Fotos",
          sourceDescription: "Eigene Aufnahmen",
        },
      },
    },
  });
  projectId = project.id;

  // Minimale „fertige“ Video-Assets simulieren (Job-Pipeline testet der Worker).
  const storage = getStorage();
  const makeAsset = async (kind: "FINAL_VIDEO" | "POSTER", filename: string) => {
    const data = Buffer.from(`fake-${filename}`);
    const storageKey = projectStorageKey(
      ctx.organizationId,
      projectId,
      "final",
      filename
    );
    await storage.put(storageKey, data, "video/mp4");
    return prisma.mediaAsset.create({
      data: {
        projectId,
        kind,
        storageKey,
        filename,
        mimeType: kind === "POSTER" ? "image/jpeg" : "video/mp4",
        sizeBytes: data.length,
        sha256: sha256Hex(data),
      },
    });
  };
  const master = await makeAsset("FINAL_VIDEO", "walkthrough-16x9-v1.mp4");
  const reel = await makeAsset("FINAL_VIDEO", "walkthrough-9x16-v1.mp4");
  const poster = await makeAsset("POSTER", "poster-v1.jpg");
  await prisma.videoVersion.create({
    data: {
      projectId,
      version: 1,
      master16x9AssetId: master.id,
      reel9x16AssetId: reel.id,
      posterAssetId: poster.id,
      durationSec: 24,
    },
  });
});

afterAll(async () => {
  await cleanupTestContext(ctx);
});

describe("Freigabe & Export-Gating", () => {
  test("Export vor Freigabe → 403", async () => {
    const response = await exportRoute(
      jsonRequest(`/api/projects/${projectId}/export`, "POST", ctx),
      params({ id: projectId })
    );
    expect(response.status).toBe(403);
  });

  test("unvollständige Checkliste → 422", async () => {
    const response = await approveRoute(
      jsonRequest(`/api/projects/${projectId}/approve`, "POST", ctx, {
        ...FULL_CHECKLIST,
        privacyReviewed: false,
      }),
      params({ id: projectId })
    );
    expect(response.status).toBe(422);
  });

  test("vollständige Checkliste → Freigabe mit Snapshot", async () => {
    const response = await approveRoute(
      jsonRequest(`/api/projects/${projectId}/approve`, "POST", ctx, FULL_CHECKLIST),
      params({ id: projectId })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.snapshotSha256).toHaveLength(64);

    const project = await prisma.propertyProject.findUnique({
      where: { id: projectId },
    });
    expect(project?.status).toBe("APPROVED");

    const record = await prisma.approvalRecord.findFirst({
      where: { projectId },
    });
    const snapshot = record?.snapshot as { assets: Array<{ sha256: string }> };
    expect(snapshot.assets.length).toBeGreaterThanOrEqual(3);
    expect(snapshot.assets.every((a) => a.sha256.length === 64)).toBe(true);
  });

  test("doppelte Freigabe (bereits APPROVED) → 409", async () => {
    const response = await approveRoute(
      jsonRequest(`/api/projects/${projectId}/approve`, "POST", ctx, FULL_CHECKLIST),
      params({ id: projectId })
    );
    expect(response.status).toBe(409);
  });

  test("Export nach Freigabe liefert Download-Referenzen", async () => {
    const response = await exportRoute(
      jsonRequest(`/api/projects/${projectId}/export`, "POST", ctx),
      params({ id: projectId })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    const references = body.data.references as Record<string, string>;
    expect(Object.keys(references).length).toBeGreaterThanOrEqual(2);
    for (const url of Object.values(references)) {
      expect(url).toMatch(/sig=/);
    }
    const project = await prisma.propertyProject.findUnique({
      where: { id: projectId },
    });
    expect(project?.status).toBe("EXPORTED");
  });

  test("Freigabe zurückziehen → zurück in Prüfung", async () => {
    const response = await revokeApprovalRoute(
      jsonRequest(`/api/projects/${projectId}/approve`, "DELETE", ctx),
      params({ id: projectId })
    );
    expect(response.status).toBe(200);
    const project = await prisma.propertyProject.findUnique({
      where: { id: projectId },
    });
    expect(project?.status).toBe("NEEDS_REVIEW");

    // …und Export ist sofort wieder gesperrt.
    const exportResponse = await exportRoute(
      jsonRequest(`/api/projects/${projectId}/export`, "POST", ctx),
      params({ id: projectId })
    );
    expect(exportResponse.status).toBe(403);
  });
});
