"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ProjectStatusDto, ShotDto } from "@/lib/dto";
import { apiRequest, jsonInit, ROOM_LABEL_OPTIONS } from "@/lib/clientApi";

const EDITABLE: ProjectStatusDto[] = ["DRAFT", "NEEDS_REVIEW", "READY", "FAILED"];

interface Props {
  projectId: string;
  status: ProjectStatusDto;
  shots: ShotDto[];
  photoCount: number;
  /** Externer KI-Video-Provider konfiguriert → Hybrid-Spalte anzeigen. */
  externalVideoEnabled: boolean;
}

export function ShotsSection({
  projectId,
  status,
  shots,
  photoCount,
  externalVideoEnabled,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editable = EDITABLE.includes(status);

  async function propose() {
    if (
      shots.length > 0 &&
      !window.confirm("Bestehende Shotliste durch neuen Vorschlag ersetzen?")
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    const result = await apiRequest(`/api/projects/${projectId}/shots`, {
      method: "POST",
    });
    setBusy(false);
    if (!result.ok) setError(result.error ?? "Vorschlag fehlgeschlagen.");
    router.refresh();
  }

  async function patch(
    updates: Array<{
      id: string;
      selected?: boolean;
      roomLabel?: string;
      preferAiVideo?: boolean;
      narration?: string | null;
    }>
  ) {
    const result = await apiRequest(
      `/api/projects/${projectId}/shots`,
      jsonInit("PATCH", { updates })
    );
    if (!result.ok) setError(result.error ?? "Änderung fehlgeschlagen.");
    router.refresh();
  }

  async function move(shotId: string, direction: -1 | 1) {
    const ordered = [...shots].sort((a, b) => a.sortIndex - b.sortIndex);
    const index = ordered.findIndex((s) => s.id === shotId);
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    const result = await apiRequest(
      `/api/projects/${projectId}/shots`,
      jsonInit("PUT", { orderedIds: ordered.map((s) => s.id) })
    );
    if (!result.ok) setError(result.error ?? "Umsortieren fehlgeschlagen.");
    router.refresh();
  }

  const selectedCount = shots.filter((s) => s.selected).length;
  const totalDuration = shots
    .filter((s) => s.selected)
    .reduce((sum, s) => sum + s.durationSec, 0);

  return (
    <section className="card" id="shots">
      <h2>3 · Shotliste</h2>
      <p className="muted small">
        Automatischer Vorschlag: 6–10 Hero-Aufnahmen in Begehungsreihenfolge.
        Reihenfolge, Auswahl und Raum-Label sind frei anpassbar.
      </p>

      {editable && (
        <div className="actions-row" style={{ marginBottom: "0.75rem" }}>
          <button
            type="button"
            className="btn primary"
            onClick={propose}
            disabled={busy || photoCount === 0}
          >
            {busy
              ? "Erstelle Vorschlag…"
              : shots.length === 0
                ? "Shotliste vorschlagen"
                : "Neu vorschlagen"}
          </button>
          {photoCount === 0 && (
            <span className="muted small">Bitte zuerst Fotos hochladen.</span>
          )}
        </div>
      )}

      {error && <div className="alert error">{error}</div>}

      {shots.length === 0 ? (
        <div className="empty-state">Noch keine Shotliste erstellt.</div>
      ) : (
        <>
          <p className="small muted">
            {selectedCount} Szene(n) ausgewählt · Gesamtlänge ca.{" "}
            {totalDuration.toLocaleString("de-DE")} s
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Bild</th>
                <th>Raum</th>
                <th>Kamerabewegung</th>
                <th>Szenentext</th>
                <th>Dauer</th>
                <th>Im Video</th>
                {externalVideoEnabled && <th title="Szene über den externen KI-Video-Provider rendern">KI-Video</th>}
                {editable && <th>Reihenfolge</th>}
              </tr>
            </thead>
            <tbody>
              {shots.map((shot, index) => (
                <tr key={shot.id} style={{ opacity: shot.selected ? 1 : 0.55 }}>
                  <td>{index + 1}</td>
                  <td>
                    {shot.imageUrl && (
                      <img
                        src={shot.imageUrl}
                        alt=""
                        style={{ width: 72, height: 44, objectFit: "cover", borderRadius: 6 }}
                      />
                    )}
                  </td>
                  <td>
                    {editable ? (
                      <select
                        value={shot.roomLabel}
                        onChange={(e) =>
                          patch([{ id: shot.id, roomLabel: e.target.value }])
                        }
                      >
                        {ROOM_LABEL_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      ROOM_LABEL_OPTIONS.find((o) => o.value === shot.roomLabel)?.label
                    )}
                  </td>
                  <td className="muted small" title={shot.prompt}>
                    {shot.cameraMoveLabel}
                  </td>
                  <td>
                    {editable ? (
                      <input
                        defaultValue={shot.narration ?? ""}
                        placeholder="z. B. Die offene Küche mit Kochinsel."
                        maxLength={160}
                        style={{ minWidth: 220 }}
                        onBlur={(e) => {
                          if ((shot.narration ?? "") !== e.target.value) {
                            patch([{ id: shot.id, narration: e.target.value || null }]);
                          }
                        }}
                      />
                    ) : (
                      <span className="muted small">{shot.narration ?? "—"}</span>
                    )}
                  </td>
                  <td className="muted small">{shot.durationSec.toLocaleString("de-DE")} s</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={shot.selected}
                      disabled={!editable}
                      onChange={(e) =>
                        patch([{ id: shot.id, selected: e.target.checked }])
                      }
                    />
                  </td>
                  {externalVideoEnabled && (
                    <td>
                      <input
                        type="checkbox"
                        checked={shot.preferAiVideo}
                        disabled={!editable}
                        onChange={(e) =>
                          patch([{ id: shot.id, preferAiVideo: e.target.checked }])
                        }
                      />
                    </td>
                  )}
                  {editable && (
                    <td>
                      <button type="button" className="btn sm" disabled={index === 0} onClick={() => move(shot.id, -1)}>
                        ↑
                      </button>{" "}
                      <button
                        type="button"
                        className="btn sm"
                        disabled={index === shots.length - 1}
                        onClick={() => move(shot.id, 1)}
                      >
                        ↓
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
