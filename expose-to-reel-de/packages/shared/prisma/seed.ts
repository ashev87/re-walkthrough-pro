import { loadRootEnv } from "../src/loadEnv";

loadRootEnv();

import { PrismaClient, type RoomLabel } from "@prisma/client";
import { hashPassword, sha256Hex } from "../src/crypto";
import {
  buildShotPrompt,
  cameraMoveForRoom,
} from "../src/domain/cameraMoves";
import { ROOM_LABEL_NAMES } from "../src/domain/rooms";
import { selectHeroShots } from "../src/domain/shotSelection";
import { getStorage, projectStorageKey } from "../src/storage/index";
import {
  floorplanImage,
  lowResImage,
  roomImage,
  type SeedImage,
} from "./seedImages";

/**
 * Seed: Demo-Organisation, Demo-Nutzer und drei realistische deutsche
 * Exposés (Mietwohnung, Eigentumswohnung, Einfamilienhaus) inklusive
 * generierter Platzhalterfotos, Rechte-Bestätigung und Shotlisten-Vorschlag.
 *
 * Ausführen: npm run db:seed  (benötigt DATABASE_URL; Fotos landen im
 * konfigurierten Objektspeicher, Standard: .data/storage)
 */

const prisma = new PrismaClient();

interface SeedPhoto {
  filename: string;
  roomLabel: RoomLabel;
  image: SeedImage;
  caption?: string;
}

const PALETTE: Record<string, [[number, number, number], [number, number, number]]> = {
  AUSSENANSICHT: [[96, 125, 139], [176, 190, 197]],
  EINGANG: [[121, 85, 72], [215, 204, 200]],
  FLUR: [[141, 110, 99], [239, 235, 233]],
  WOHNZIMMER: [[255, 183, 77], [255, 236, 179]],
  KUECHE: [[77, 182, 172], [224, 242, 241]],
  ESSBEREICH: [[229, 152, 102], [252, 228, 214]],
  SCHLAFZIMMER: [[121, 134, 203], [232, 234, 246]],
  ARBEITSZIMMER: [[100, 141, 174], [222, 233, 241]],
  BAD: [[129, 212, 250], [225, 245, 254]],
  BALKON_TERRASSE: [[174, 213, 129], [241, 248, 233]],
  GARTEN: [[124, 179, 66], [220, 237, 200]],
  AUSSICHT: [[79, 134, 198], [207, 226, 243]],
  SONSTIGES: [[158, 158, 158], [238, 238, 238]],
};

function photoFor(
  roomLabel: RoomLabel,
  filename: string,
  seed: number,
  caption?: string
): SeedPhoto {
  const [a, b] = PALETTE[roomLabel] ?? PALETTE.SONSTIGES!;
  return { filename, roomLabel, image: roomImage(a, b, seed), caption };
}

async function createProjectWithData(input: {
  organizationId: string;
  userId: string;
  titel: string;
  listing: Record<string, unknown>;
  photos: SeedPhoto[];
  sourceDescription: string;
}) {
  const project = await prisma.propertyProject.create({
    data: {
      organizationId: input.organizationId,
      title: input.titel,
      status: "DRAFT",
      sourceType: "MANUAL_UPLOAD",
    },
  });

  await prisma.listingData.create({
    data: {
      projectId: project.id,
      ...(input.listing as object),
    } as never,
  });

  const storage = getStorage();
  const assets = [];
  for (const [index, photo] of input.photos.entries()) {
    const storageKey = projectStorageKey(
      input.organizationId,
      project.id,
      "source",
      `seed-${index + 1}-${photo.filename}`
    );
    await storage.put(storageKey, photo.image.buffer, "image/png");
    const asset = await prisma.mediaAsset.create({
      data: {
        projectId: project.id,
        kind: "SOURCE_IMAGE",
        storageKey,
        filename: photo.filename,
        mimeType: "image/png",
        sizeBytes: photo.image.buffer.length,
        width: photo.image.width,
        height: photo.image.height,
        sha256: sha256Hex(photo.image.buffer),
        perceptualHash: photo.image.perceptualHash,
        whiteRatio: photo.image.whiteRatio,
        caption: photo.caption ?? null,
        sortIndex: index,
        roomLabel: photo.roomLabel,
        isLowResolution:
          photo.image.width < 1024 || photo.image.height < 683,
        isLikelyFloorplan: photo.roomLabel === "GRUNDRISS",
      },
    });
    assets.push(asset);
  }

  // Duplikat-Markierung über identische aHashes (wie die Heuristik).
  for (let i = 0; i < assets.length; i++) {
    for (let j = 0; j < i; j++) {
      if (
        assets[i]!.perceptualHash === assets[j]!.perceptualHash &&
        !assets[i]!.duplicateOfId
      ) {
        await prisma.mediaAsset.update({
          where: { id: assets[i]!.id },
          data: { duplicateOfId: assets[j]!.id },
        });
        assets[i] = { ...assets[i]!, duplicateOfId: assets[j]!.id };
      }
    }
  }

  await prisma.rightsAttestation.create({
    data: {
      projectId: project.id,
      userId: input.userId,
      scope: "Alle in diesem Projekt hochgeladenen Fotos",
      sourceDescription: input.sourceDescription,
    },
  });

  // Shotlisten-Vorschlag wie in der App.
  const { selectedIds } = selectHeroShots(
    assets.map((asset) => ({
      id: asset.id,
      roomLabel: asset.roomLabel ?? "SONSTIGES",
      sortIndex: asset.sortIndex,
      isLowResolution: asset.isLowResolution,
      isLikelyFloorplan: asset.isLikelyFloorplan,
      duplicateOfId: asset.duplicateOfId,
      excluded: asset.excluded,
      width: asset.width,
      height: asset.height,
    }))
  );
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  for (const [index, assetId] of selectedIds.entries()) {
    const asset = assetById.get(assetId)!;
    const roomLabel = asset.roomLabel ?? "SONSTIGES";
    const move = cameraMoveForRoom(roomLabel);
    await prisma.shot.create({
      data: {
        projectId: project.id,
        mediaAssetId: assetId,
        roomLabel,
        sortIndex: index,
        selected: true,
        durationSec: 4,
        cameraMove: move.key,
        prompt: buildShotPrompt({
          roomLabel,
          roomName: ROOM_LABEL_NAMES[roomLabel],
          moveInstruction: move.instruction,
        }),
      },
    });
  }

  await prisma.propertyProject.update({
    where: { id: project.id },
    data: { status: "NEEDS_REVIEW" },
  });
  await prisma.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      projectId: project.id,
      userId: input.userId,
      type: "project.seeded",
    },
  });
  return project;
}

async function main() {
  console.info("[seed] Starte…");

  // Idempotent: vorhandene Demo-Organisation zuerst entfernen.
  const existing = await prisma.organization.findFirst({
    where: { name: "Demo Immobilien GmbH" },
    include: { projects: { select: { id: true } } },
  });
  if (existing) {
    console.info("[seed] Entferne vorhandene Demo-Daten…");
    const storage = getStorage();
    for (const project of existing.projects) {
      await storage.deletePrefix(`org/${existing.id}/project/${project.id}/`);
    }
    await prisma.auditEvent.deleteMany({ where: { organizationId: existing.id } });
    await prisma.propertyProject.deleteMany({ where: { organizationId: existing.id } });
    await prisma.providerConnection.deleteMany({ where: { organizationId: existing.id } });
    await prisma.user.deleteMany({ where: { organizationId: existing.id } });
    await prisma.organization.delete({ where: { id: existing.id } });
  }

  const organization = await prisma.organization.create({
    data: { name: "Demo Immobilien GmbH" },
  });
  const user = await prisma.user.create({
    data: {
      email: "demo@example.com",
      name: "Doris Demo",
      passwordHash: hashPassword("demo1234"),
      organizationId: organization.id,
    },
  });

  // Provider-Verbindungen als deaktivierte Scaffolds sichtbar machen.
  await prisma.providerConnection.createMany({
    data: [
      { organizationId: organization.id, provider: "IMMOSCOUT24_IMPORT", status: "DISABLED" },
      { organizationId: organization.id, provider: "IMMOSCOUT24_PUBLISH", status: "DISABLED" },
    ],
  });

  // --- 1) Mietwohnung Leipzig (Demo-Projekt, bereit zur Generierung) ---
  await createProjectWithData({
    organizationId: organization.id,
    userId: user.id,
    titel: "Helle 3-Zimmer-Wohnung mit Balkon in Leipzig-Gohlis",
    listing: {
      marketingType: "MIETE",
      objectType: "Wohnung",
      titel: "Helle 3-Zimmer-Wohnung mit Balkon in Leipzig-Gohlis",
      plz: "04155",
      ort: "Leipzig",
      strasse: "Georg-Schumann-Straße",
      hausnummer: "12",
      addressVisibility: "CITY_ONLY",
      kaltmiete: 890,
      nebenkosten: 210,
      warmmiete: 1100,
      zimmer: 3,
      wohnflaeche: 84.5,
      baujahr: 1908,
      provision: "provisionsfrei",
      energieausweisTyp: "Verbrauchsausweis",
      energiekennwert: 96.4,
      energieklasse: "C",
      energietraeger: "Fernwärme",
      beschreibung:
        "Sanierter Altbau mit Stuck, Dielenboden und Südbalkon. Küche 2022 erneuert, Bad mit Wanne. Ruhige Seitenstraße, ÖPNV fußläufig.",
    },
    photos: [
      photoFor("AUSSENANSICHT", "aussenansicht-fassade.png", 1, "Sanierte Gründerzeit-Fassade"),
      photoFor("FLUR", "flur-dielen.png", 2),
      photoFor("WOHNZIMMER", "wohnzimmer-stuck.png", 3, "Wohnzimmer mit Stuckdecke"),
      photoFor("WOHNZIMMER", "wohnzimmer-stuck-2.png", 3), // bewusstes Duplikat
      photoFor("KUECHE", "kueche-2022.png", 4, "Einbauküche von 2022"),
      photoFor("ESSBEREICH", "essbereich.png", 5),
      photoFor("SCHLAFZIMMER", "schlafzimmer-hof.png", 6, "Schlafzimmer zum Hof"),
      photoFor("BAD", "bad-wanne.png", 7, "Bad mit Wanne"),
      photoFor("BALKON_TERRASSE", "balkon-sued.png", 8, "Südbalkon"),
      { filename: "grundriss-3zi.png", roomLabel: "GRUNDRISS", image: floorplanImage() },
    ],
    sourceDescription:
      "Eigene Aufnahmen der Hausverwaltung vom 02.07.2026 (Alleinauftrag).",
  });

  // --- 2) Eigentumswohnung Köln (Kauf) ---
  await createProjectWithData({
    organizationId: organization.id,
    userId: user.id,
    titel: "Stilvolle 2-Zimmer-Eigentumswohnung mit Rheinblick, Köln-Rodenkirchen",
    listing: {
      marketingType: "KAUF",
      objectType: "Wohnung",
      titel: "Stilvolle 2-Zimmer-Eigentumswohnung mit Rheinblick, Köln-Rodenkirchen",
      plz: "50968",
      ort: "Köln",
      addressVisibility: "CITY_ONLY",
      kaufpreis: 425000,
      zimmer: 2,
      wohnflaeche: 68,
      baujahr: 1996,
      provision: "3,57 % inkl. MwSt. käuferseitig",
      energieausweisTyp: "Bedarfsausweis",
      energiekennwert: 78.2,
      energieklasse: "B",
      energietraeger: "Gas",
      beschreibung:
        "Gepflegte Wohnung im 4. OG mit Aufzug, Loggia nach Westen und Blick über den Rhein. Tiefgaragenstellplatz optional.",
    },
    photos: [
      photoFor("AUSSENANSICHT", "aussen-haus.png", 11),
      photoFor("WOHNZIMMER", "wohnzimmer-hell.png", 12),
      photoFor("KUECHE", "kueche-offen.png", 13),
      photoFor("SCHLAFZIMMER", "schlafzimmer.png", 14),
      photoFor("BAD", "bad-dusche.png", 15),
      photoFor("BALKON_TERRASSE", "loggia-west.png", 16, "Loggia nach Westen"),
      photoFor("AUSSICHT", "rheinblick.png", 17, "Blick über den Rhein"),
      { filename: "handyfoto-keller.png", roomLabel: "SONSTIGES", image: lowResImage([120, 120, 130]) },
    ],
    sourceDescription: "Beauftragter Fotograf (Studio Licht & Raum), 28.06.2026.",
  });

  // --- 3) Einfamilienhaus Potsdam (Kauf) ---
  await createProjectWithData({
    organizationId: organization.id,
    userId: user.id,
    titel: "Freistehendes Einfamilienhaus mit Garten in Potsdam-Babelsberg",
    listing: {
      marketingType: "KAUF",
      objectType: "Einfamilienhaus",
      titel: "Freistehendes Einfamilienhaus mit Garten in Potsdam-Babelsberg",
      plz: "14482",
      ort: "Potsdam",
      strasse: "Karl-Liebknecht-Straße",
      addressVisibility: "STREET_ONLY",
      kaufpreis: 985000,
      zimmer: 5,
      wohnflaeche: 152,
      grundstuecksflaeche: 540,
      baujahr: 2009,
      provision: "2,38 % inkl. MwSt. käuferseitig",
      beschreibung:
        "Architektenhaus mit offenem Wohn-/Essbereich, Kamin, Süd-Garten mit Terrasse und Doppelcarport. Energetisch modernisiert 2021 (Wärmepumpe).",
    },
    photos: [
      photoFor("AUSSENANSICHT", "haus-front.png", 21, "Frontansicht mit Carport"),
      photoFor("EINGANG", "eingang.png", 22),
      photoFor("WOHNZIMMER", "wohnbereich-kamin.png", 23, "Wohnbereich mit Kamin"),
      photoFor("ESSBEREICH", "essbereich-offen.png", 24),
      photoFor("KUECHE", "kueche-insel.png", 25, "Küche mit Kochinsel"),
      photoFor("ARBEITSZIMMER", "arbeitszimmer.png", 26),
      photoFor("SCHLAFZIMMER", "elternschlafzimmer.png", 27),
      photoFor("BAD", "familienbad.png", 28),
      photoFor("GARTEN", "garten-sued.png", 29, "Süd-Garten mit Terrasse"),
      { filename: "grundriss-eg.png", roomLabel: "GRUNDRISS", image: floorplanImage() },
    ],
    sourceDescription: "Eigene Aufnahmen des Maklerbüros, 01.07.2026 (Alleinauftrag).",
  });

  console.info("[seed] Fertig.");
  console.info("[seed] Login: demo@example.com / demo1234");
}

main()
  .catch((error) => {
    console.error("[seed] Fehler:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
