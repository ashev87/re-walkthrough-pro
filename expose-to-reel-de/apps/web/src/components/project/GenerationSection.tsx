"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { JobDto, ProjectStatusDto } from "@/lib/dto";
import { apiRequest, roomLabelName } from "@/lib/clientApi";

interface SceneStatus {
  id: string;
  roomLabel: string;
  sortIndex: number;
  selected: boolean;
  status: "PENDING" | "RENDERING" | "DONE" | "FAILED";
  errorMessage: string | null;
}

interface JobStatusPayload {
  job: JobDto & { videoVersions?: Array<{ id: string }> };
  shots: SceneStatus[];
}

const START_ALLOWED: ProjectStatusDto[] = ["NEEDS_REVIEW", "READY", "FAILED"];

const JOB_LABELS: Record<JobDto["status"], string> = {
  QUEUED: "In Warteschlange",
  RUNNING: "Läuft",
  COMPLETED: "Abgeschlossen",
  FAILED: "Fehlgeschlagen",
  CANCELLED: "Abgebrochen",
};

const SCENE_LABELS: Record<SceneStatus["status"], string> = {
  PENDING: "wartet",
  RENDERING: "rendert…",
  DONE: "fertig",
  FAILED: "Fehler",
};

export interface GenerationCapabilities {
  music: boolean;
  tts: boolean;
}

interface GenerationOptionsState {
  withMusic: boolean;
  withTextOverlays: boolean;
  withEndCard: boolean;
  withVoiceover: boolean;
}

interface Props {
  projectId: string;
  status: ProjectStatusDto;
  latestJob: JobDto | null;
  shotCount: number;
  capabilities: GenerationCapabilities;
  hasVoiceoverScript: boolean;
}

const OPTION_DEFAULTS: GenerationOptionsState = {
  withMusic: false,
  withTextOverlays: false,
  withEndCard: false,
  withVoiceover: false,
};

export function GenerationSection({
  projectId,
  status,
  latestJob,
  shotCount,
  capabilities,
  hasVoiceoverScript,
}: Props) {
  const router = useRouter();
  const [job, setJob] = useState<JobDto | null>(latestJob);
  const [scenes, setScenes] = useState<SceneStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<GenerationOptionsState>(OPTION_DEFAULTS);
  // Idempotency-Key pro Ansicht — Doppelklicks erzeugen keinen zweiten Job.
  const idempotencyKey = useRef(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`
  );

  const active = job && (job.status === "QUEUED" || job.status === "RUNNING");

  const poll = useCallback(async () => {
    if (!job) return;
    const result = await apiRequest<JobStatusPayload>(
      `/api/projects/${projectId}/jobs/${job.id}`
    );
    if (result.ok && result.data) {
      const previousStatus = job.status;
      setJob(result.data.job);
      setScenes(result.data.shots.filter((s) => s.selected));
      if (
        result.data.job.status !== previousStatus &&
        (result.data.job.status === "COMPLETED" ||
          result.data.job.status === "FAILED" ||
          result.data.job.status === "CANCELLED")
      ) {
        router.refresh();
      }
    }
  }, [job, projectId, router]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(poll, 2000);
    poll();
    return () => clearInterval(timer);
  }, [active, poll]);

  async function start() {
    setBusy(true);
    setError(null);
    const result = await apiRequest<{ job: JobDto; reused: boolean }>(
      `/api/projects/${projectId}/generate`,
      {
        method: "POST",
        headers: {
          "idempotency-key": idempotencyKey.current,
          "content-type": "application/json",
        },
        body: JSON.stringify({ options }),
      }
    );
    setBusy(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? "Start fehlgeschlagen.");
      return;
    }
    idempotencyKey.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
    setJob(result.data.job);
    router.refresh();
  }

  async function cancel() {
    if (!job) return;
    const result = await apiRequest(
      `/api/projects/${projectId}/jobs/${job.id}/cancel`,
      { method: "POST" }
    );
    if (!result.ok) setError(result.error ?? "Abbruch fehlgeschlagen.");
    await poll();
    router.refresh();
  }

  const canStart = START_ALLOWED.includes(status) && shotCount > 0 && !active;

  return (
    <section className="card" id="generierung">
      <h2>5 · Generierung</h2>
      <p className="muted small">
        Pro ausgewähltem Bild entsteht eine kurze Szene (Foto-Motion: sanfte
        Kamerafahrt über das Originalfoto, mit Überblendungen und dezentem
        Farb-Grading — es wird nichts hinzuerfunden). Ausgabe: 16:9-Master,
        9:16-Reel (straffer geschnitten), Posterbild und Untertitel.
      </p>

      <fieldset style={{ border: "none", padding: 0, margin: "0 0 0.75rem" }}>
        <legend className="small" style={{ fontWeight: 600, color: "var(--text-muted)" }}>
          Optionen
        </legend>
        <div className="checkbox-row">
          <input
            id="opt-overlays"
            type="checkbox"
            checked={options.withTextOverlays}
            onChange={(e) =>
              setOptions((prev) => ({ ...prev, withTextOverlays: e.target.checked }))
            }
          />
          <label htmlFor="opt-overlays" className="small">
            <strong>Text-Overlays</strong> — Raum-Name dezent in jeder Szene einblenden.
          </label>
        </div>
        <div className="checkbox-row">
          <input
            id="opt-endcard"
            type="checkbox"
            checked={options.withEndCard}
            onChange={(e) =>
              setOptions((prev) => ({ ...prev, withEndCard: e.target.checked }))
            }
          />
          <label htmlFor="opt-endcard" className="small">
            <strong>Endkarte</strong> — Abschluss-Karte mit Titel, Lage und Eckdaten (3 s).
          </label>
        </div>
        <div className="checkbox-row">
          <input
            id="opt-music"
            type="checkbox"
            disabled={!capabilities.music}
            checked={options.withMusic}
            onChange={(e) =>
              setOptions((prev) => ({ ...prev, withMusic: e.target.checked }))
            }
          />
          <label htmlFor="opt-music" className="small" style={{ opacity: capabilities.music ? 1 : 0.6 }}>
            <strong>Hintergrundmusik</strong>{" "}
            {capabilities.music
              ? "— Track aus MUSIC_TRACK_PATH, leise gemischt mit Ausblendung."
              : "— nicht konfiguriert (MUSIC_TRACK_PATH in .env auf eine lizenzierte Audiodatei setzen)."}
          </label>
        </div>
        <div className="checkbox-row">
          <input
            id="opt-voiceover"
            type="checkbox"
            disabled={!capabilities.tts || !hasVoiceoverScript}
            checked={options.withVoiceover}
            onChange={(e) =>
              setOptions((prev) => ({ ...prev, withVoiceover: e.target.checked }))
            }
          />
          <label
            htmlFor="opt-voiceover"
            className="small"
            style={{ opacity: capabilities.tts && hasVoiceoverScript ? 1 : 0.6 }}
          >
            <strong>Voiceover</strong>{" "}
            {!capabilities.tts
              ? "— nicht konfiguriert (OPENAI_API_KEY für TTS setzen)."
              : !hasVoiceoverScript
                ? "— zuerst ein Voiceover-Skript in Abschnitt 4 speichern."
                : "— gespeichertes Skript wird eingesprochen und eingemischt."}
          </label>
        </div>
      </fieldset>

      <div className="actions-row">
        <button
          type="button"
          className="btn primary"
          onClick={start}
          disabled={!canStart || busy}
        >
          {busy
            ? "Starte…"
            : job && job.status === "FAILED"
              ? "Erneut versuchen"
              : "Video generieren"}
        </button>
        {active && (
          <button type="button" className="btn danger" onClick={cancel}>
            Abbrechen
          </button>
        )}
        {!START_ALLOWED.includes(status) && !active && (
          <span className="muted small">
            Start ist im aktuellen Status nicht möglich.
          </span>
        )}
        {shotCount === 0 && (
          <span className="muted small">Bitte zuerst eine Shotliste erstellen.</span>
        )}
      </div>

      {error && <div className="alert error">{error}</div>}

      {job && (
        <div style={{ marginTop: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.35rem" }}>
            <strong className="small">
              Job: {JOB_LABELS[job.status]}
              {job.currentStep ? ` — ${job.currentStep}` : ""}
            </strong>
            <span className="small muted">{job.progress}%</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${job.progress}%` }} />
          </div>
          {job.status === "FAILED" && job.errorMessage && (
            <div className="alert error" style={{ marginTop: "0.6rem" }}>
              Fehlerdetails: {job.errorMessage}
            </div>
          )}
          {job.status === "CANCELLED" && (
            <div className="alert info" style={{ marginTop: "0.6rem" }}>
              Der Job wurde abgebrochen.
            </div>
          )}
          {scenes.length > 0 && (
            <ul className="scene-list">
              {scenes.map((scene, index) => (
                <li key={scene.id}>
                  <span className="muted small">{index + 1}.</span>
                  <span style={{ flex: 1 }}>{roomLabelName(scene.roomLabel)}</span>
                  <span className={`scene-status ${scene.status}`}>
                    {SCENE_LABELS[scene.status]}
                  </span>
                  {scene.errorMessage && (
                    <span className="small" style={{ color: "var(--danger)" }}>
                      {scene.errorMessage}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
