/**
 * S3-kompatible Objektspeicher-Abstraktion. Quelle­bilder, Szenen und fertige
 * Videos sind niemals öffentlich — Zugriff nur über signierte, ablaufende URLs.
 */
export interface ObjectStorage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Signierte, zeitlich begrenzte Download-URL (Standard: 15 Minuten). */
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

export const SIGNED_URL_DEFAULT_TTL = 15 * 60;

/** Einheitliches Key-Schema: org/<orgId>/project/<projectId>/<bereich>/<datei> */
export function projectStorageKey(
  orgId: string,
  projectId: string,
  area: "source" | "normalized" | "scenes" | "final",
  filename: string
): string {
  return `org/${orgId}/project/${projectId}/${area}/${filename}`;
}

export function projectStoragePrefix(orgId: string, projectId: string): string {
  return `org/${orgId}/project/${projectId}/`;
}
