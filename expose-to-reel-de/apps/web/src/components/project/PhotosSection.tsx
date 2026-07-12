"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { PhotoDto, ProjectStatusDto } from "@/lib/dto";
import {
  apiRequest,
  jsonInit,
  ROOM_LABEL_OPTIONS,
  roomLabelName,
} from "@/lib/clientApi";

const EDITABLE: ProjectStatusDto[] = ["DRAFT", "NEEDS_REVIEW", "FAILED"];

interface Props {
  projectId: string;
  status: ProjectStatusDto;
  photos: PhotoDto[];
  hasAttestation: boolean;
}

export function PhotosSection({ projectId, status, photos, hasAttestation }: Props) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sourceDescription, setSourceDescription] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [attesting, setAttesting] = useState(false);
  const editable = EDITABLE.includes(status);

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    setInfo(null);
    let uploaded = 0;
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      const result = await apiRequest(`/api/projects/${projectId}/photos`, {
        method: "POST",
        body: form,
      });
      if (!result.ok) {
        setError(`${file.name}: ${result.error ?? "Upload fehlgeschlagen."}`);
        break;
      }
      uploaded++;
    }
    if (uploaded > 0) {
      setInfo(`${uploaded} Foto(s) hochgeladen und automatisch analysiert.`);
      router.refresh();
    }
    if (fileInput.current) fileInput.current.value = "";
    setUploading(false);
  }

  async function patchPhoto(photoId: string, payload: unknown) {
    const result = await apiRequest(
      `/api/projects/${projectId}/photos/${photoId}`,
      jsonInit("PATCH", payload)
    );
    if (!result.ok) setError(result.error ?? "Änderung fehlgeschlagen.");
    router.refresh();
  }

  async function removePhoto(photoId: string, filename: string) {
    if (!window.confirm(`Foto „${filename}“ wirklich löschen?`)) return;
    const result = await apiRequest(
      `/api/projects/${projectId}/photos/${photoId}`,
      { method: "DELETE" }
    );
    if (!result.ok) setError(result.error ?? "Löschen fehlgeschlagen.");
    router.refresh();
  }

  async function move(photoId: string, direction: -1 | 1) {
    const ordered = [...photos].sort((a, b) => a.sortIndex - b.sortIndex);
    const index = ordered.findIndex((p) => p.id === photoId);
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    const result = await apiRequest(
      `/api/projects/${projectId}/photos`,
      jsonInit("PUT", { orderedIds: ordered.map((p) => p.id) })
    );
    if (!result.ok) setError(result.error ?? "Umsortieren fehlgeschlagen.");
    router.refresh();
  }

  async function submitAttestation(event: React.FormEvent) {
    event.preventDefault();
    setAttesting(true);
    setError(null);
    const result = await apiRequest(
      `/api/projects/${projectId}/rights`,
      jsonInit("POST", {
        scope: "Alle in diesem Projekt hochgeladenen Fotos",
        sourceDescription,
        confirmed: true,
      })
    );
    setAttesting(false);
    if (!result.ok) {
      setError(result.error ?? "Bestätigung fehlgeschlagen.");
      return;
    }
    setInfo("Rechte-Bestätigung gespeichert.");
    router.refresh();
  }

  return (
    <section className="card" id="fotos">
      <h2>2 · Fotos & Kuratierung</h2>
      <p className="muted small">
        Automatische Vorschläge für Raum-Label, Duplikate, Grundrisse und
        niedrige Auflösung — jede Entscheidung kann überstimmt werden.
      </p>

      {editable && (
        <div className="actions-row" style={{ marginBottom: "1rem" }}>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            style={{ display: "none" }}
            onChange={(e) => uploadFiles(e.target.files)}
          />
          <button
            type="button"
            className="btn primary"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            {uploading ? "Lädt hoch…" : "Fotos hochladen"}
          </button>
          <span className="muted small">JPEG/PNG/WebP · max. 15 MB · min. 320×320 px</span>
        </div>
      )}

      {error && <div className="alert error">{error}</div>}
      {info && <div className="alert success">{info}</div>}

      {photos.length === 0 ? (
        <div className="empty-state">Noch keine Fotos hochgeladen.</div>
      ) : (
        <div className="photo-grid">
          {photos.map((photo, index) => (
            <div key={photo.id} className={`photo-card${photo.excluded ? " excluded" : ""}`}>
              <img src={photo.url} alt={photo.caption ?? photo.filename} loading="lazy" />
              <div className="body">
                <div className="photo-flags">
                  {photo.isLikelyFloorplan && <span className="flag warn">Grundriss?</span>}
                  {photo.isLowResolution && <span className="flag warn">Niedrige Auflösung</span>}
                  {photo.duplicateOfId && <span className="flag warn">Duplikat?</span>}
                  {photo.excluded && <span className="flag">Ausgeschlossen</span>}
                </div>
                {editable ? (
                  <>
                    <select
                      value={photo.roomLabel ?? "SONSTIGES"}
                      onChange={(e) => patchPhoto(photo.id, { roomLabel: e.target.value })}
                    >
                      {ROOM_LABEL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <input
                      defaultValue={photo.caption ?? ""}
                      placeholder="Bildunterschrift"
                      onBlur={(e) => {
                        if ((photo.caption ?? "") !== e.target.value) {
                          patchPhoto(photo.id, { caption: e.target.value || null });
                        }
                      }}
                    />
                    <div className="actions-row" style={{ marginTop: 0 }}>
                      <button type="button" className="btn sm" disabled={index === 0} onClick={() => move(photo.id, -1)} title="Nach vorn">
                        ↑
                      </button>
                      <button type="button" className="btn sm" disabled={index === photos.length - 1} onClick={() => move(photo.id, 1)} title="Nach hinten">
                        ↓
                      </button>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => patchPhoto(photo.id, { excluded: !photo.excluded })}
                      >
                        {photo.excluded ? "Einschließen" : "Ausschließen"}
                      </button>
                      {photo.duplicateOfId && (
                        <button type="button" className="btn sm" onClick={() => patchPhoto(photo.id, { clearDuplicate: true })}>
                          Kein Duplikat
                        </button>
                      )}
                      {photo.isLikelyFloorplan && (
                        <button type="button" className="btn sm" onClick={() => patchPhoto(photo.id, { isLikelyFloorplan: false })}>
                          Kein Grundriss
                        </button>
                      )}
                      <button type="button" className="btn sm danger" onClick={() => removePhoto(photo.id, photo.filename)}>
                        Löschen
                      </button>
                    </div>
                  </>
                ) : (
                  <span className="muted small">{roomLabelName(photo.roomLabel)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: "1.25rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
        <h3>Quellen- & Rechte-Bestätigung</h3>
        {hasAttestation ? (
          <div className="alert success">
            Rechte-Bestätigung liegt vor: Nutzungsrechte an allen hochgeladenen
            Fotos wurden bestätigt.
          </div>
        ) : (
          <form onSubmit={submitAttestation}>
            <div className="field" style={{ marginBottom: "0.5rem" }}>
              <label>Herkunft der Fotos *</label>
              <input
                required
                minLength={3}
                placeholder="z. B. Eigene Aufnahmen vom 05.07.2026 / beauftragter Fotograf XY"
                value={sourceDescription}
                onChange={(e) => setSourceDescription(e.target.value)}
              />
            </div>
            <div className="checkbox-row">
              <input
                id="rights-confirm"
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <label htmlFor="rights-confirm" className="small">
                Ich bestätige, dass ich zur Vermarktung dieses Objekts berechtigt
                bin und die Nutzungsrechte an allen hochgeladenen Fotos besitze.
              </label>
            </div>
            <button className="btn" type="submit" disabled={!confirmed || attesting}>
              {attesting ? "Speichern…" : "Bestätigung speichern"}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
