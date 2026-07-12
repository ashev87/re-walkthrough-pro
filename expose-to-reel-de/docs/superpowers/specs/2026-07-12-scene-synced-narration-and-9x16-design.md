# Szenen-synchrone Texte & besseres 9:16-Reel — Design

Datum: 2026-07-12 · Status: Entwurf zur Umsetzung

## Kontext

Heute erzeugt die Generierung (a) ein freies Voiceover-Skript, das als eine
durchgehende TTS-Spur über das ganze Video gelegt wird, (b) Text-Overlays,
die nur den Raum-Namen zeigen, und (c) SRT-Untertitel mit Intro-Fakten +
Raum-Namen. Nichts davon ist inhaltlich an die gerade gezeigte Szene
gekoppelt. Das 9:16-Reel entsteht durch Skalieren + Mitten-Crop der
Querformat-Fotos (≈ 70 % der Bildbreite gehen verloren) und ist auf max.
3 s pro Szene beschnitten.

## Ziele

1. **Szenen-Skript als Single Source of Truth**: eine kurze Textzeile pro
   Shot; Voiceover, On-Screen-Text und SRT leiten sich daraus ab und sind
   automatisch synchron zur gezeigten Szene.
2. **9:16 nativ statt Crop**: Querformat-Fotos werden im Reel per
   horizontalem Kameraschwenk („Sweep“) vollständig gezeigt; Grundrisse und
   Hochformat-Bilder bekommen einen Blur-Pad-Hintergrund. Der 3-s-Deckel
   entfällt — Reel-Szenen laufen so lang wie im 16:9-Master.

## Nicht-Ziele

- Kein KI-Saliency-Cropping, keine Provider-Timestamps (ElevenLabs
  character timing), keine Änderung am 16:9-Master-Rendering.
- Kein automatisches Anpassen der Szenendauer an die Sprechlänge über die
  definierte Verlängerungsgrenze hinaus (s. u.).

## Teil 1 — Szenen-Skript

### Datenmodell

- `Shot.narration String?` (neue Migration). Die Zeile lebt am Shot: wird
  die Shotliste neu vorgeschlagen, entstehen neue Shots und die Zeilen
  werden mit-generiert; manuelle Edits pro Shot bleiben bei Reihenfolge-
  Änderungen erhalten.
- `marketingTexts.voiceoverScript` bleibt als Fallback: Haben keine
  ausgewählten Shots eine `narration`, verhält sich das Voiceover wie heute
  (eine durchgehende Spur).

### Generierung der Zeilen

- Die bestehende Aktion „Mit KI vorschlagen“ (Abschnitt 4) erzeugt
  zusätzlich `sceneLines`: je ausgewähltem Shot eine Zeile (Reihenfolge =
  Shotliste). Der Prompt erhält pro Shot Raum-Name und Dauer und ein
  Wortbudget ≈ 2,5 Wörter/s (hartes Maximum ~110 Zeichen pro Zeile);
  ausschließlich freigegebene Fakten, wie bisher.
- Antwortschema (zod + JSON-Schema analog `marketingTextsSchema`):
  `sceneLines: Array<{ sortIndex: number; text: string }>` — gemappt auf
  die Shot-IDs der aktuellen Auswahl, per `prisma.shot.update` gespeichert.
- UI: In der Shotliste (Abschnitt 3) bekommt jeder Shot ein einzeiliges
  Textfeld „Szenentext“ (editierbar, PATCH über die bestehende Shot-Route).

### Verwendung im Worker

Gemeinsame Timeline-Berechnung (neues Modul `sceneTimeline.ts` im Worker,
unit-testbar, ersetzt die Inline-Cue-Logik):

1. **Dauer-Anpassung („auto-extend“)**: Vor dem Rendern wird jede
   Narration-Zeile per TTS synthetisiert (ein Segment pro Shot, nur wenn
   Voiceover-Option aktiv). Segmentdauer per ffprobe. Ist das Segment
   länger als `shot.durationSec − 0,3 s`, wird die Szenendauer auf
   `Segmentdauer + 0,4 s` verlängert — **maximal +2 s** über die
   konfigurierte Dauer. Reicht das nicht, wird das Segment am Szenenende
   mit 0,3 s ausgeblendet (afade) und eine Warnung geloggt.
   Die angepassten Dauern gelten für beide Formate (16:9 und 9:16 teilen
   sich jetzt die Timeline, s. Teil 2).
2. **Audio-Timeline**: Segmente werden mit `adelay` an den Szenenstart
   gesetzt (Startzeiten = kumulierte Dauern − Crossfade-Versätze, gleiche
   Mathematik wie `buildSrt`), mit Stille aufgefüllt und zu einer
   Voiceover-Spur gemischt; danach unverändert durch `mixAudio`
   (Musik-Ducking funktioniert weiter). Statt des bisherigen pauschalen
   600-ms-Vorlaufs startet jedes Segment 0,3 s nach seinem Szenenstart.
3. **On-Screen-Text**: `SceneRenderSpec` erhält `narrationText?`. Der
   Foto-Motion-Provider zeichnet ihn als zweite drawtext-Zeile oberhalb des
   Raum-Labels (kleinere Schrift, gleiche Box-Optik). Zeilenumbruch: simple
   Wortgrenzen-Umbruchfunktion auf ≤ 2 Zeilen, Ziel ~34 Zeichen/Zeile in
   9:16 bzw. ~60 in 16:9 (drawtext kann \n). Gilt nur bei aktivierter
   Option „Text-Overlays“.
4. **SRT**: Cue-Text = `narration` (Fallback Raum-Name); Cue 1 behält den
   Intro-Fakten-Block. Timing aus derselben Timeline wie Audio/Szenen.

### Fehlerverhalten

- TTS-Fehler eines Segments: Warnung, Szene ohne Narration-Audio (Overlay
  und SRT zeigen die Zeile trotzdem); Job schlägt nicht fehl.
- Shots ohne `narration`: keine Verlängerung, kein Segment, Overlay/SRT wie
  bisher (nur Raum-Name).

## Teil 2 — 9:16-Rendering

### Spec-Erweiterung

`SceneRenderSpec` erhält `sourceAspect?: number` (Breite/Höhe des
normalisierten Bilds, vom Worker aus den Asset-Maßen bzw. ffprobe gesetzt)
und `isFloorplan?: boolean` (aus `shot.roomLabel === "GRUNDRISS"` oder
`mediaAsset.isLikelyFloorplan`).

### Foto-Motion, Portrait-Ziel (height > width)

- **Sweep-Modus** (Querformat-Quelle, `sourceAspect ≥ 1.2`, kein
  Grundriss): skaliere auf 2× Zielhöhe (lanczos, Breite proportional),
  animiertes `crop=w=oh*9/16` mit x-Ausdruck über die volle Bildbreite
  (Smoothstep-Easing in `t`, wie `easedProgress`), dann Downscale auf
  1080×1920. Kein zoompan (dessen Fenster erzwingt das Eingabe-
  Seitenverhältnis). Schwenkrichtung: `cameraMove.panX`, falls 0 →
  alternierend per `sortIndex` (gerade → links-nach-rechts).
- **Blur-Pad-Modus** (Grundriss oder `sourceAspect < 1.2`): Hintergrund =
  Bild auf 1080×1920 gefüllt, `gblur` stark + leicht abgedunkelt;
  Vordergrund = Bild auf Breite 1080 eingepasst, zentriert overlayed;
  auf dem Komposit läuft der normale (sanfte) Ken-Burns-Push-in — das
  Komposit hat exakt Zielformat, zoompan funktioniert dort unverändert.
- Grading, Labels, Wasserzeichen-Zweig unverändert danach.

### Pacing

- `REEL_MAX_SCENE_SEC` entfällt; `sceneDurationFor` gibt für beide Formate
  `shot.durationSec` (ggf. auto-extended) zurück. Damit stimmen auch
  Voiceover-Timeline und SRT für das Reel ohne Sonderfall.
- Crossfade bleibt 0,35 s.

## Teststrategie

- **Unit (worker)**: `sceneTimeline` — Verlängerungslogik (kürzer/knapp/
  über Limit), Startzeiten mit Crossfade, SRT-Erzeugung aus der Timeline.
- **Unit (shared)**: Zeilenumbruch-Funktion; Filtergraph-Bau des
  Foto-Motion-Providers als reine Funktion exportieren und für 16:9,
  9:16-Sweep, 9:16-Blur-Pad per String-Assertions testen.
- **Integration**: bestehender Pipeline-Test um einen Lauf mit `narration`
  auf zwei Shots erweitern (TTS gemockt, ffmpeg real): prüft verlängerte
  Gesamtdauer, SRT-Inhalt und dass 9:16 ohne 3-s-Deckel rendert.
- **Texts-Provider**: Schema-Test für `sceneLines` (Mapping sortIndex →
  Shot, Überlänge wird abgeschnitten/abgelehnt).

## Migration & Rollout

- Prisma-Migration `add_shot_narration` (nullable, kein Backfill).
- Bestehende Projekte: verhalten sich unverändert, bis Zeilen generiert
  oder eingetragen werden. Keine Options-/UI-Brüche: „Voiceover“ und
  „Text-Overlays“ behalten ihre Bedeutung, nur die Inhalte werden szenen-
  spezifisch, sobald Narration-Zeilen existieren.
