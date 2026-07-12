# Exposé-to-Reel DE

Ein deutschsprachiges Immobilien-Marketing-Tool: aus einem **autorisierten
Exposé** und dessen Fotos wird ein **kinoreifes Room-by-Room-Walkthrough-Video**
(16:9-Master + 9:16-Reel + Poster + Untertitel).

> **Wichtig — Zweckbindung:** Dieses Produkt ist für Makler/Bauträger gedacht,
> die **eigene bzw. zur Vermarktung autorisierte Objekte** bewerben.
> **Öffentliches Scraping von ImmoScout24 (oder anderen Portalen) wird nicht
> unterstützt.** Der Portal-Import existiert nur als deaktiviertes Scaffold
> hinter Feature-Flags und setzt eine autorisierte Verbindung voraus.

## Architektur

```
expose-to-reel-de/
├── apps/web        Next.js App Router (deutsche UI, API-Route-Handler)
├── apps/worker     Node-Worker (BullMQ) für ffmpeg-Medienjobs
├── packages/shared Prisma-Schema, Domänenlogik, Provider, Storage
└── docker-compose  PostgreSQL 16 · Redis 7 · MinIO
```

- **PostgreSQL + Prisma** — Projekte, Exposé-Daten, Medien-Metadaten, Shots,
  Jobs, Videoversionen, Rechte-Bestätigungen, Freigabe-Snapshots, Audit.
- **Redis + BullMQ** — Job-Queue mit Retries, Fortschritt und Abbruch.
- **Objektspeicher-Abstraktion** — `STORAGE_DRIVER=local` (Entwicklung, mit
  HMAC-signierten URLs über die Web-App) oder `s3` (MinIO/AWS S3, presigned
  URLs). Medien sind **nie öffentlich**.
- **ffmpeg/ffprobe** — Bildnormalisierung, Ken-Burns-Szenen, Konkatenation,
  Poster, SRT-Untertitel und Output-Validierung (Codec/Auflösung/Dauer).

## Lokales Setup

Voraussetzungen: **Node ≥ 20**, **Docker Desktop**, **ffmpeg/ffprobe**.

ffmpeg installieren:

| OS | Befehl |
|---|---|
| Windows | `winget install Gyan.FFmpeg` (danach neues Terminal öffnen) |
| macOS | `brew install ffmpeg` |
| Debian/Ubuntu | `sudo apt install ffmpeg` |

Liegt ffmpeg nicht im `PATH`, in `.env` die Variablen `FFMPEG_PATH` /
`FFPROBE_PATH` setzen (unter Windows wird zusätzlich der winget-Link-Ordner
automatisch probiert).

```bash
cd expose-to-reel-de
cp .env.example .env            # Werte prüfen; für lokale Entwicklung ok
npm install

npm run infra:up                # Postgres + Redis + MinIO (docker compose)
npm run db:migrate:dev          # Prisma-Migrationen anwenden (erzeugt Client)
npm run db:seed                 # Demo-Login + 3 deutsche Beispiel-Exposés

npm run dev:worker              # Terminal 1 — Medien-Worker
npm run dev:web                 # Terminal 2 — http://localhost:3000
```

**Demo-Login:** `demo@example.com` / `demo1234`

> **Port belegt?** Läuft bereits ein Dienst auf Port 3000, die App auf einem
> anderen Port starten und `WEB_BASE_URL` in `.env` anpassen:
> `cd apps/web && npx next dev -p 3001` und `WEB_BASE_URL="http://localhost:3001"`.

Kompletter Durchlauf in der UI: Projekt öffnen (z. B. „Helle 3-Zimmer-Wohnung
… Leipzig-Gohlis“) → Shotliste prüfen/anpassen → **Video generieren** →
Vorschau ansehen → Checkliste abhaken → **Projekt freigeben** →
**Download-Links erzeugen** (16:9 + 9:16 + Poster + SRT).

## Umgebungsvariablen

Alle Variablen inkl. Beschreibung: [.env.example](.env.example). Kernpunkte:

| Variable | Bedeutung |
|---|---|
| `DATABASE_URL` | PostgreSQL-Verbindung |
| `REDIS_URL` | Redis für BullMQ |
| `SESSION_SECRET` | HMAC-Secret für Session-Cookies und lokale signierte Storage-URLs |
| `CREDENTIALS_ENCRYPTION_KEY` | 32-Byte-Hex-Schlüssel; AES-256-GCM für Provider-Credentials |
| `STORAGE_DRIVER` | `local` (Standard) oder `s3` (MinIO/AWS) |
| `FFMPEG_PATH` / `FFPROBE_PATH` | Nur nötig, wenn nicht im PATH |
| `VIDEO_PROVIDER` | `foto_motion` (Standard, ohne Wasserzeichen) · `mock` (gleicher Renderer mit MOCK-Label) · `external` (fällt ohne Konfiguration auf foto_motion zurück) |
| `IS24_IMPORT_ENABLED` / `IS24_PUBLISH_ENABLED` | Feature-Flags der ImmoScout24-Scaffolds (Standard: aus) |
| `LLM_PROVIDER` | LLM für die KI-Optionen: `anthropic` (Standard) oder `minimax` (MiniMax M3) |
| `ANTHROPIC_API_KEY` / `MINIMAX_API_KEY` | Key des gewählten Providers — aktiviert KI-Bildanalyse (`IMAGE_ANALYSIS_PROVIDER=ai`) + KI-Marketing-Texte |
| `OPENAI_API_KEY` / `ELEVENLABS_API_KEY` | Opt-in: Voiceover per TTS (`TTS_PROVIDER` wählt; sonst entscheidet der vorhandene Key) |
| `MUSIC_TRACK_PATH` | Opt-in: Hintergrundmusik (lizenzierte Audiodatei des Betreibers) |

Es liegen **keine Secrets im Repository**; `.env` ist git-ignoriert.

## Tests, Typen, Lint

```bash
npm run test:unit           # Domänenlogik (Zustandsmaschine, Shot-Auswahl, …)
npm run test:integration    # Route-Handler + Job-Pipeline (benötigt docker compose + ffmpeg)
npm test                    # beides
npm run typecheck
npm run lint
```

Integrationstests erwarten die lokale Infrastruktur (`npm run infra:up` und
angewendete Migrationen) sowie ffmpeg. Der Job-Lebenszyklus-Test rendert echte
MP4s und validiert sie mit ffprobe.

## Provider-Adapter-Design

Alle externen Systeme liegen hinter Interfaces in
`packages/shared/src/providers/`:

| Interface | Implementiert | Status |
|---|---|---|
| `ListingSourceProvider` | `ManualUploadProvider` | ✅ aktiv (MVP-Pfad) |
| | Propstack-Import (Python-Bridge, [services/propstack](services/propstack/README.md)) | ✅ aktiv, sobald `propstack_api_key` gesetzt ist |
| | `ImmoScout24ListingProvider` | 🔒 Scaffold, deaktiviert (Feature-Flag + Apify-Actor-Konfiguration nötig) |
| `ImageAnalysisProvider` | `HeuristicImageAnalysisProvider` | ✅ aktiv — deterministisch, ohne KI-Schlüssel (Label aus Dateinamen, Duplikate über aHash, Grundrisse über Weißanteil) |
| `VideoGenerationProvider` | `FotoMotionVideoProvider` | ✅ aktiv (Standard) — geglätteter ffmpeg-Ken-Burns (Ease-in/out), 0,35-s-Überblendungen, dezentes Farb-Grading; `VIDEO_PROVIDER=mock` = derselbe Renderer mit sichtbarem „MOCK-VORSCHAU“-Label |
| | `ExternalImageToVideoProvider` | 🔒 dokumentierter Adapter, wirft `ProviderNotConfiguredError` (keine erfundenen Endpunkte) |
| `PublishingProvider` | `LocalDownloadPublisher` | ✅ aktiv — signierte Download-URLs nach Freigabe |
| | `ImmoScout24PublishingAdapter` | 🔒 Scaffold, deaktiviert |

**Warum Foto-Motion statt KI-Video?** Ohne verifizierten, lizenzierten
Image-to-Video-Dienst erfinden wir keine API-Endpunkte. Foto-Motion ist der
kostenfreie Produktionspfad: eine geglättete virtuelle Kamerafahrt über das
Originalfoto (Ease-in/out statt linear), kurze Überblendungen zwischen den
Räumen, ein dezenter Farb-Look und strafferes 9:16-Pacing (max. 3 s pro
Szene) — es wird nichts hinzuerfunden, daher kein Wasserzeichen nötig.
`VIDEO_PROVIDER=mock` nutzt denselben Renderer mit deutlichem MOCK-Label für
Demos. Die Prompts für einen späteren echten KI-Provider sind bereits
enthalten und verbieten explizit das Hinzufügen von Objekten, Personen,
baulichen Änderungen, Text oder unbelegten Ausblicken (`CONTENT_GUARDRAILS`).

### Optionale Erweiterungen (alle Opt-in)

Jede Erweiterung ist einzeln aktivierbar; ohne Konfiguration bleibt die
jeweilige Option in der UI sichtbar deaktiviert und die App arbeitet mit
den Basis-Funktionen weiter.

| Option | Aktivierung | Verhalten |
|---|---|---|
| **KI-Bildanalyse** | `IMAGE_ANALYSIS_PROVIDER=ai` + LLM-Key | Das Vision-Modell klassifiziert Uploads gegen die Raum-Taxonomie und erkennt Grundrisse; bei jedem Fehler stiller Rückfall auf die Heuristik |
| **KI-Marketing-Texte** | LLM-Key | Abschnitt „Texte“: Caption, Objektbeschreibung, Voiceover-Skript — strikt aus den freigegebenen Fakten, immer als prüfbarer Entwurf |
| **Text-Overlays** | Checkbox bei der Generierung | Raum-Name dezent in jeder Szene |
| **Endkarte** | Checkbox bei der Generierung | 3-s-Abschluss-Karte mit Titel, Lage, Eckdaten und Firmenname |
| **Hintergrundmusik** | `MUSIC_TRACK_PATH` + Checkbox | Lizenzierter Track des Betreibers, geloopt/leise gemischt, Ausblendung am Ende |
| **Voiceover** | `OPENAI_API_KEY` *oder* `ELEVENLABS_API_KEY` + gespeichertes Skript + Checkbox | TTS spricht das geprüfte Skript ein (ElevenLabs: `eleven_multilingual_v2`, erkennt Deutsch automatisch; Stimme via `ELEVENLABS_VOICE_ID`); wird mit ggf. abgesenkter Musik gemischt und als MP3-Asset gespeichert |
| **Hybrid-KI-Video** | Externer Video-Provider konfiguriert | Pro Shot wählbar („KI-Video“-Spalte): Hero-Szenen über den KI-Provider, Rest Foto-Motion — ohne Provider unsichtbar |

**LLM-Provider:** `LLM_PROVIDER=anthropic` (Standard, `ANTHROPIC_API_KEY`,
Modell `claude-opus-4-8`) oder `LLM_PROVIDER=minimax` (`MINIMAX_API_KEY`,
Modell `MiniMax-M3`). MiniMax wird über deren Anthropic-kompatiblen Endpunkt
(`https://api.minimax.io/anthropic`) mit demselben SDK angesprochen; M3
unterstützt auch die Bild-Eingabe der KI-Bildanalyse. Da MiniMax keine
Structured Outputs dokumentiert, erzwingt der Code dort das JSON-Format per
Prompt und parst tolerant. Modelle sind über `LLM_VISION_MODEL` /
`LLM_TEXT_MODEL` überschreibbar (z. B. `claude-haiku-4-5` für günstige
Bildklassifikation).

### Propstack-Import (eigenes CRM)

Der Makler kann Objekte direkt aus seinem eigenen Propstack-CRM übernehmen
(Objektdaten, verknüpfter Eigentümer-Kontakt, Fotos). Die REST-Logik ist 1:1
aus dem MWA_webapp-Projekt übernommen und läuft als Python-Bridge — Details,
Kontrakt und Geschäftsregeln: [services/propstack/README.md](services/propstack/README.md).

Aktivieren:

1. `pip install -r services/propstack/requirements.txt` (benötigt Python ≥ 3.10)
2. `propstack_api_key=<rotierter Key>` in `.env` setzen (niemals einchecken)
3. Neues Projekt → Quelle „Propstack-Import“ → Objekt-ID oder CRM-URL
   (`https://crm.propstack.de/app/units/5472912`) eingeben.

Der Import legt ein Entwurfs-Projekt mit Exposé-Daten und Fotos an; die
Rechte-Bestätigung und die Prüfung der übernommenen Fakten bleiben bewusst
manuelle Schritte vor der Generierung. Pro Objekt fallen mindestens 3–4
Propstack-API-Calls an (Rate-Limits beachten).

### Autorisierte ImmoScout24-Integration später aktivieren

1. **Import:** autorisierten Zugang klären (offizielle API des Kunden oder ein
   vom Rechteinhaber genehmigter Apify-Actor). Dann `IS24_IMPORT_ENABLED=true`,
   `APIFY_TOKEN`, `APIFY_IS24_ACTOR_ID` setzen. Der Adapter ruft den Actor über
   die dokumentierte Apify-API (`run-sync-get-dataset-items`) auf und mappt
   nur eindeutig vorhandene Felder — Rest bleibt zur manuellen Pflege leer.
2. **Publishing:** offiziellen OAuth-Zugang des Betreibers beschaffen,
   `IS24_PUBLISH_ENABLED=true` + `IS24_API_BASE_URL` +
   `IS24_OAUTH_CLIENT_ID/SECRET` setzen und den Adapter
   (`providers/publishing/immoscout24.ts`) gegen die Vertragsdokumentation
   implementieren. Veröffentlichung bleibt an **Freigabe + explizite
   Nutzeraktion** gebunden.
3. Credentials pro Organisation gehören verschlüsselt in `ProviderConnection`
   (AES-256-GCM, `encryptCredentials()`); Umgebungsvariablen sind nur für die
   Entwicklung gedacht. Secrets werden nie geloggt.

## Sicherheit & Compliance (implementiert)

- Organisations-gebundene Sessions (HMAC-Cookie, 12 h); jede Query ist
  org-gescoped, fremde Projekte ⇒ 404.
- Upload-Validierung: Magic Bytes vs. deklarierter MIME-Typ, Größe ≤ 15 MB,
  Mindest-/Maximalabmessungen; Metadaten werden bei der Normalisierung
  entfernt (`-map_metadata -1`).
- Server-seitige Zustandsmaschine; **Export/Veröffentlichung nur nach
  Freigabe** (vollständige Checkliste ⇒ unveränderlicher Snapshot inkl.
  SHA-256-Hashes aller Assets).
- Rate-Limiting (Login, Generierung) und **Idempotency-Key** auf dem
  Generierungs-Endpunkt.
- Signierte, ablaufende Storage-URLs; Standard-Adresssichtbarkeit „nur
  PLZ/Ort“.
- Lösch-Workflow inkl. Objektspeicher: siehe [DATENSCHUTZ.md](DATENSCHUTZ.md).

## Was ist implementiert vs. Scaffold?

**Implementiert (funktioniert lokal):** manueller End-to-End-Fluss (Projekt →
Exposé-Daten → Upload+Kuratierung → Shotliste → Foto-Motion-Generierung 16:9/9:16 →
Freigabe → Download), Worker-Pipeline mit Fortschritt/Abbruch/Retry,
Heuristik-Bildanalyse, Seeds mit drei deutschen Beispiel-Exposés, Unit- und
Integrationstests.

**Scaffold / bewusst deaktiviert:** ImmoScout24-Import und -Publishing
(Feature-Flags, keine Credentials im Repo), externer KI-Video-Provider
(dokumentierter Adapter), KI-Bildanalyse (Heuristik ist der Fallback),
Redis-basiertes Rate-Limiting für Multi-Instanz-Betrieb.

## Produktions-Hinweise (außerhalb des MVP)

- In-Memory-Rate-Limiter durch Redis-Limiter ersetzen (Multi-Instanz).
- HTTPS-Terminierung, `secure`-Cookies, CSP-Header.
- Objektspeicher-Lifecycle-Regeln und Backup-Rotation (siehe DATENSCHUTZ.md).
- Worker horizontal skalieren (BullMQ-Concurrency pro Instanz = 1 wegen ffmpeg).
