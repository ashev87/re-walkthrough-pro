import imageSize from "image-size";

/**
 * Validierung hochgeladener Bilder an der Systemgrenze:
 * Typ, Größe, Abmessungen und dekodierbare Metadaten.
 */

export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB
export const MIN_WIDTH = 320;
export const MIN_HEIGHT = 320;
export const MAX_DIMENSION = 12_000;

/** Unterhalb dieser Auflösung markieren wir „niedrige Auflösung“. */
export const LOW_RES_WIDTH = 1024;
export const LOW_RES_HEIGHT = 683;

export interface ValidatedImage {
  width: number;
  height: number;
  mimeType: string;
  isLowResolution: boolean;
}

export class UploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

const MAGIC: Array<{ mime: string; check: (b: Buffer) => boolean }> = [
  {
    mime: "image/jpeg",
    check: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: "image/png",
    check: (b) =>
      b.length > 8 && b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
  },
  {
    mime: "image/webp",
    check: (b) =>
      b.length > 12 &&
      b.subarray(0, 4).toString("ascii") === "RIFF" &&
      b.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

export function detectMimeType(buffer: Buffer): string | null {
  for (const { mime, check } of MAGIC) {
    if (check(buffer)) return mime;
  }
  return null;
}

export function validateUploadedImage(
  buffer: Buffer,
  declaredMimeType: string
): ValidatedImage {
  if (buffer.length === 0) {
    throw new UploadValidationError("Leere Datei.");
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError(
      `Datei zu groß (max. ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB).`
    );
  }
  if (!ALLOWED_MIME_TYPES.has(declaredMimeType)) {
    throw new UploadValidationError(
      "Nicht unterstützter Dateityp. Erlaubt: JPEG, PNG, WebP."
    );
  }
  const actualMime = detectMimeType(buffer);
  if (!actualMime || actualMime !== declaredMimeType) {
    throw new UploadValidationError(
      "Dateiinhalt entspricht nicht dem angegebenen Bildtyp."
    );
  }

  let dimensions: { width?: number; height?: number };
  try {
    dimensions = imageSize(buffer);
  } catch {
    throw new UploadValidationError("Bild konnte nicht gelesen werden (defekte Datei?).");
  }
  const { width, height } = dimensions;
  if (!width || !height) {
    throw new UploadValidationError("Bildabmessungen konnten nicht ermittelt werden.");
  }
  if (width < MIN_WIDTH || height < MIN_HEIGHT) {
    throw new UploadValidationError(
      `Bild zu klein (mindestens ${MIN_WIDTH}×${MIN_HEIGHT} px).`
    );
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new UploadValidationError("Bildabmessungen zu groß.");
  }

  return {
    width,
    height,
    mimeType: declaredMimeType,
    isLowResolution: width < LOW_RES_WIDTH || height < LOW_RES_HEIGHT,
  };
}
