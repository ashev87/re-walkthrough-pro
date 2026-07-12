import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { prisma, recordAudit, resolveFromWorkspaceRoot } from "@e2r/shared";
import { ApiError } from "../api";
import type { SessionUser } from "../session";
import { uploadPhoto } from "./photos";

const execFileAsync = promisify(execFile);

/**
 * Propstack-Import über die Python-Bridge (services/propstack).
 *
 * Die eigentliche REST-Logik (PropstackClient, Owner-Auflösung, Dropdown-
 * Normalisierung) ist 1:1 aus MWA_webapp übernommen und wird NICHT in
 * TypeScript reimplementiert — Node startet `python fetch_property.py <id>`
 * und konsumiert dessen JSON-Kontrakt. Der API-Key lebt ausschließlich in
 * der Umgebungsvariable `propstack_api_key`.
 */

const BRIDGE_SCRIPT = "services/propstack/fetch_property.py";
const BRIDGE_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_MAX_IMAGES = 20;

export interface PropstackContactBlock {
  anrede: string;
  geehrte: string;
  titel: string;
  vorname: string;
  nachname: string;
  email: string;
  briefanrede: string;
  salutation_status: "mapped" | "company" | "unmapped";
}

export interface PropstackImage {
  id: number;
  url: string;
  big_url?: string;
  title?: string | null;
  is_floorplan?: boolean;
  is_private?: boolean;
  position?: number;
}

export interface PropstackPayload {
  id: number;
  raw: Record<string, unknown>;
  expanded: Record<string, unknown>;
  custom_fields: Record<string, unknown>;
  contact: PropstackContactBlock;
  normalized: Record<string, unknown>;
  broker: Record<string, unknown> | null;
  address: {
    street: string | null;
    house_number: string | null;
    zip_code: string | null;
    city: string | null;
    district: string | null;
  };
  images: PropstackImage[];
}

interface BridgeResult {
  ok: boolean;
  code?: string;
  error?: string;
  data?: PropstackPayload;
}

export function isPropstackConfigured(): boolean {
  return (
    Boolean(process.env.propstack_api_key) ||
    process.env.PROPSTACK_FIXTURES === "1"
  );
}

/** Bridge-Aufruf: ein Propstack-Objekt als JSON. */
export async function fetchPropstackProperty(
  propertyId: string
): Promise<PropstackPayload> {
  const python = process.env.PYTHON_BIN || "python";
  const script = resolveFromWorkspaceRoot(BRIDGE_SCRIPT);

  let stdout: string;
  try {
    const result = await execFileAsync(python, [script, propertyId], {
      timeout: BRIDGE_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
      cwd: path.dirname(script),
      windowsHide: true,
    });
    stdout = result.stdout;
  } catch (error) {
    // execFile wirft bei Exit-Code ≠ 0 — der JSON-Fehlerkontrakt liegt in stdout.
    const failed = error as { stdout?: string; code?: string | number; message?: string };
    stdout = failed.stdout ?? "";
    if (!stdout) {
      if (failed.code === "ENOENT") {
        throw new ApiError(
          503,
          "Python wurde nicht gefunden — für den Propstack-Import wird Python 3 benötigt (siehe README)."
        );
      }
      console.error("[propstack] Bridge-Fehler ohne Ausgabe:", failed.message);
      throw new ApiError(502, "Propstack-Bridge lieferte keine Antwort.");
    }
  }

  let parsed: BridgeResult;
  try {
    parsed = JSON.parse(stdout) as BridgeResult;
  } catch {
    console.error("[propstack] Unlesbare Bridge-Antwort:", stdout.slice(0, 500));
    throw new ApiError(502, "Propstack-Bridge lieferte eine unlesbare Antwort.");
  }

  if (!parsed.ok || !parsed.data) {
    switch (parsed.code) {
      case "missing_api_key":
        throw new ApiError(
          501,
          "Propstack-Key nicht konfiguriert (propstack_api_key in .env setzen)."
        );
      case "invalid_id":
        throw new ApiError(422, "Ungültige Propstack-Objekt-ID.");
      case "not_found":
        throw new ApiError(404, parsed.error ?? "Objekt nicht gefunden.");
      case "timeout":
        throw new ApiError(504, parsed.error ?? "Propstack-Zeitlimit überschritten.");
      default:
        throw new ApiError(502, parsed.error ?? "Propstack-Abruf fehlgeschlagen.");
    }
  }
  return parsed.data;
}

const asNumber = (value: unknown): number | null => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n !== 0 ? n : null;
};
const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/** Propstack-Rohdaten → ListingData-Felder (nur belegte CRM-Werte, nichts erfinden). */
function mapListingData(payload: PropstackPayload) {
  const raw = payload.raw;
  const isMiete = asString(raw.marketing_type)?.toUpperCase() === "RENT";
  const objektTyp =
    asString(payload.custom_fields.mwa_objekttyp) ??
    asString(raw.object_type) ??
    asString(raw.rs_type) ??
    "Immobilie";
  const titel =
    asString(raw.title) ?? asString(raw.name) ?? `Propstack-Objekt ${payload.id}`;

  return {
    marketingType: isMiete ? ("MIETE" as const) : ("KAUF" as const),
    objectType: objektTyp,
    titel,
    plz: asString(payload.address.zip_code) ?? "",
    ort: asString(payload.address.city) ?? "",
    strasse: asString(payload.address.street),
    hausnummer: asString(payload.address.house_number),
    // Datenschutz-Standard: genaue Adresse erst nach expliziter Nutzerentscheidung.
    addressVisibility: "CITY_ONLY" as const,
    kaufpreis: isMiete ? null : asNumber(raw.price),
    kaltmiete: isMiete ? asNumber(raw.base_rent) : null,
    nebenkosten: isMiete ? asNumber(raw.service_charge) : null,
    warmmiete: isMiete ? asNumber(raw.total_rent) : null,
    zimmer: asNumber(raw.number_of_rooms),
    wohnflaeche: asNumber(raw.living_space),
    grundstuecksflaeche: asNumber(raw.plot_area),
    baujahr: asNumber(raw.construction_year),
    provision: asString(raw.courtage),
    beschreibung: asString(raw.description_note),
  };
}

/**
 * PROPSTACK_MAX_IMAGES robust auslesen: leere/ungültige Werte (etwa der
 * ""-Platzhalter aus der .env-Vorlage) fallen auf den Standard zurück —
 * Number("") wäre 0 und würde den Foto-Import komplett abschalten.
 * Explizite Werte inkl. "0" (Tests: keine Downloads) bleiben erhalten.
 */
export function resolveMaxImages(raw: string | undefined): number {
  const trimmed = raw?.trim();
  if (!trimmed) return DEFAULT_MAX_IMAGES;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_IMAGES;
}

export interface PropstackImportResult {
  projectId: string;
  titel: string;
  contact: PropstackContactBlock;
  imagesImported: number;
  imagesSkipped: number;
}

/**
 * Legt aus einem Propstack-Objekt ein neues Projekt an: Exposé-Daten +
 * Fotos (inkl. Grundriss-Kennzeichnung). Rechte-Bestätigung bleibt bewusst
 * ein manueller Schritt des Nutzers.
 */
export async function importPropstackProject(
  user: SessionUser,
  propertyId: string
): Promise<PropstackImportResult> {
  const payload = await fetchPropstackProperty(propertyId);
  const listing = mapListingData(payload);

  const project = await prisma.propertyProject.create({
    data: {
      organizationId: user.organizationId,
      title: listing.titel,
      status: "DRAFT",
      sourceType: "PROPSTACK",
      listingData: { create: listing },
    },
  });

  const maxImages = resolveMaxImages(process.env.PROPSTACK_MAX_IMAGES);
  const candidates = (payload.images ?? [])
    .filter((img) => !img.is_private && img.url)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .slice(0, maxImages);

  let imported = 0;
  let skipped = 0;
  for (const image of candidates) {
    try {
      const response = await fetch(image.big_url || image.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
      const urlName = decodeURIComponent(
        new URL(image.url).pathname.split("/").pop() ?? `propstack-${image.id}.jpg`
      );
      // CRM-Bildtitel („Wohnzimmer“, „Grundriss“, …) als Dateiname nutzen —
      // besser lesbar und Futter für die Raum-Label-Heuristik.
      const extension = urlName.match(/\.(jpe?g|png|webp)$/i)?.[0] ?? ".jpg";
      const filename = image.title?.trim()
        ? `${image.title.trim()}${extension}`
        : urlName;
      const asset = await uploadPhoto(user, project.id, {
        buffer,
        filename,
        mimeType: contentType,
        caption: image.title ?? undefined,
      });
      if (image.is_floorplan) {
        await prisma.mediaAsset.update({
          where: { id: asset.id },
          data: { roomLabel: "GRUNDRISS", isLikelyFloorplan: true },
        });
      }
      imported++;
    } catch (error) {
      skipped++;
      console.warn(
        `[propstack] Bild ${image.id} übersprungen:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  await recordAudit(prisma, {
    organizationId: user.organizationId,
    projectId: project.id,
    userId: user.id,
    type: "project.imported.propstack",
    data: {
      propstackUnitId: payload.id,
      imagesImported: imported,
      imagesSkipped: skipped,
      ownerSalutationStatus: payload.contact.salutation_status,
    },
  });

  return {
    projectId: project.id,
    titel: listing.titel,
    contact: payload.contact,
    imagesImported: imported,
    imagesSkipped: skipped,
  };
}
