"use client";

/** Kleine Fetch-Hilfe: einheitliche Fehlerbehandlung der JSON-API. */

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export async function apiRequest<T = unknown>(
  url: string,
  init?: RequestInit
): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, init);
    const body = (await response.json().catch(() => null)) as ApiResult<T> | null;
    if (!body) {
      return { ok: false, error: `Unerwartete Antwort (${response.status}).` };
    }
    return body;
  } catch {
    return { ok: false, error: "Server nicht erreichbar." };
  }
}

export function jsonInit(method: string, payload: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
}

export const ROOM_LABEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "AUSSENANSICHT", label: "Aussenansicht" },
  { value: "EINGANG", label: "Eingang" },
  { value: "FLUR", label: "Flur" },
  { value: "WOHNZIMMER", label: "Wohnzimmer" },
  { value: "KUECHE", label: "Küche" },
  { value: "ESSBEREICH", label: "Essbereich" },
  { value: "SCHLAFZIMMER", label: "Schlafzimmer" },
  { value: "ARBEITSZIMMER", label: "Arbeitszimmer" },
  { value: "BAD", label: "Bad" },
  { value: "BALKON_TERRASSE", label: "Balkon/Terrasse" },
  { value: "GARTEN", label: "Garten" },
  { value: "AUSSICHT", label: "Aussicht" },
  { value: "GRUNDRISS", label: "Grundriss" },
  { value: "SONSTIGES", label: "Sonstiges" },
];

/**
 * Kamerabewegungen für das Shotlisten-Dropdown — Werte/Labels gespiegelt aus
 * packages/shared/src/domain/cameraMoves.ts (Client-Bundle ohne Shared-Import,
 * gleiches Muster wie ROOM_LABEL_OPTIONS).
 */
export const CAMERA_MOVE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "approach", label: "Dezente Annäherung" },
  { value: "forward", label: "Langsame Vorwärtsbewegung" },
  { value: "orbit", label: "Sanfter Orbit/Push-in" },
  { value: "lateral", label: "Langsame Seitwärtsfahrt" },
  { value: "pushIn", label: "Ruhiger Push-in" },
  { value: "reveal", label: "Langsames Aufdecken" },
  { value: "outwardReveal", label: "Sanftes Öffnen nach außen" },
  { value: "still", label: "Nahezu statisch" },
];

export function roomLabelName(value: string | null): string {
  return (
    ROOM_LABEL_OPTIONS.find((option) => option.value === value)?.label ??
    "Ohne Label"
  );
}
