import { prisma } from "@e2r/shared";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { POST as createProjectRoute } from "@/app/api/projects/route";
import {
  cleanupTestContext,
  createTestContext,
  jsonRequest,
  type TestContext,
} from "../helpers";

/**
 * Propstack-Import über die Python-Bridge im Fixture-Modus (offline, ohne
 * Key): serviert die eingecheckten Samples für Objekt 5472912. Benötigt
 * Python 3 im PATH.
 */

let ctx: TestContext;

beforeAll(async () => {
  process.env.PROPSTACK_FIXTURES = "1"; // Bridge offline
  process.env.PROPSTACK_MAX_IMAGES = "0"; // keine Netz-Downloads im Test
  ctx = await createTestContext();
});

afterAll(async () => {
  delete process.env.PROPSTACK_FIXTURES;
  delete process.env.PROPSTACK_MAX_IMAGES;
  await cleanupTestContext(ctx);
});

describe("Propstack-Import", () => {
  test("ohne Referenz → 422", async () => {
    const response = await createProjectRoute(
      jsonRequest("/api/projects", "POST", ctx, { sourceType: "PROPSTACK" })
    );
    expect(response.status).toBe(422);
  });

  test("Kontakt-Link wird abgelehnt (keine Objekt-ID)", async () => {
    const response = await createProjectRoute(
      jsonRequest("/api/projects", "POST", ctx, {
        sourceType: "PROPSTACK",
        propstackRef: "https://crm.propstack.de/app/contacts/clients/31692831",
      })
    );
    expect(response.status).toBe(422);
  });

  test("CRM-URL importiert Objekt 5472912 mit Eigentümer aus verknüpftem Kontakt", async () => {
    const response = await createProjectRoute(
      jsonRequest("/api/projects", "POST", ctx, {
        sourceType: "PROPSTACK",
        propstackRef: "https://crm.propstack.de/app/units/5472912",
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();

    // Eigentümer kommt aus dem verknüpften Kontakt — nicht aus mwa_email.
    expect(body.data.contact.email).toBe("ch.le@gmx.de");
    expect(body.data.contact.email).not.toBe("slenkeit@gmail.com");
    expect(body.data.contact.briefanrede).toBe("Sehr geehrte Frau Lenkeit");
    expect(body.data.contact.salutation_status).toBe("mapped");

    const project = await prisma.propertyProject.findUniqueOrThrow({
      where: { id: body.data.id },
      include: { listingData: true },
    });
    expect(project.sourceType).toBe("PROPSTACK");
    expect(project.status).toBe("DRAFT");
    const listing = project.listingData!;
    // Dropdown mwa_objekttyp aufgelöst (Options-ID → Name, wie pretty_value).
    expect(listing.objectType).toBe("Einfamilienhaus mit Garten");
    expect(listing.marketingType).toBe("KAUF");
    expect(listing.plz).toBe("14195");
    expect(listing.ort).toBe("Berlin");
    expect(Number(listing.zimmer)).toBe(7);
    expect(Number(listing.wohnflaeche)).toBe(250);
    // Datenschutz-Standard: Adresse nur PLZ/Ort, bis der Nutzer es ändert.
    expect(listing.addressVisibility).toBe("CITY_ONLY");

    const audit = await prisma.auditEvent.findFirst({
      where: { projectId: project.id, type: "project.imported.propstack" },
    });
    expect(audit).toBeTruthy();
  });

  test("unbekannte Objekt-ID im Fixture-Modus → 404", async () => {
    const response = await createProjectRoute(
      jsonRequest("/api/projects", "POST", ctx, {
        sourceType: "PROPSTACK",
        propstackRef: "999999",
      })
    );
    expect(response.status).toBe(404);
  });
});
