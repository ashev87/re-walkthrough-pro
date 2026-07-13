# Deployment auf Railway

Runbook für den Produktivbetrieb von **Exposé-to-Reel DE**. Ein einziges
Docker-Image (`expose-to-reel-de/Dockerfile`) bedient **beide** Dienste — Web
und Worker unterscheiden sich nur im Start-Command.

## Aktueller Stand (produktiv)

| | |
|---|---|
| Web-App | https://web-production-e34cc.up.railway.app |
| Objektspeicher (MinIO, S3-API) | https://storage-production-b843.up.railway.app |
| Railway-Projekt | `expose-to-reel-de` (Dienste: web, worker, storage, Postgres, Redis) |

Neu ausrollen nach einem Merge auf `main`:

```bash
cd expose-to-reel-de
railway up --service web      # migriert beim Start automatisch
railway up --service worker
```

Hinweise aus der Ersteinrichtung (Railway-CLI-Eigenheiten):

- Der Dienst **storage** baut nicht das Haupt-Dockerfile, sondern
  `deploy/minio/Dockerfile` — gesetzt über die Variable
  `RAILWAY_DOCKERFILE_PATH=deploy/minio/Dockerfile`.
- Öffentliche Domains brauchen einen **expliziten Ziel-Port**
  (`web` → 3000, `storage` → 9000). Ohne Port-Angabe rät Railway falsch
  (bei MinIO die Konsole auf 9001) und die Domain liefert 502.
- `S3_ENDPOINT` muss die **öffentliche** MinIO-Domain sein: Die signierten
  URLs werden im Browser geöffnet; ein interner `*.railway.internal`-Endpunkt
  wäre von dort nicht erreichbar.

## 1. Dienste

| Dienst | Quelle | Rolle |
|---|---|---|
| **web** | `expose-to-reel-de/Dockerfile` | `E2R_ROLE=web` (Standard) |
| **worker** | dasselbe Dockerfile/Image | `E2R_ROLE=worker` |
| **minio** | `expose-to-reel-de/deploy/minio/Dockerfile` | — |
| **Postgres** | Railway-Plugin | — |
| **Redis** | Railway-Plugin | — |

**Railway kann per CLI weder einen Start-Befehl noch ein Pre-Deploy-Command pro
Dienst setzen.** Beides steckt deshalb im Image: `docker-entrypoint.sh` wählt die
Rolle über `E2R_ROLE` und der Web-Dienst wendet die Migrationen beim Start selbst an.

| `E2R_ROLE` | Verhalten |
|---|---|
| `web` (Standard) | `prisma migrate deploy` → danach `next start -p $PORT`. Schlägt die Migration fehl, startet der Container **nicht** (kein stiller Fehler). |
| `worker` | `tsx src/index.ts` (BullMQ-Worker), **keine** Migrationen. |
| alles andere | Abbruch mit Exit-Code 1 und deutscher Fehlermeldung. |

- Railway injiziert `PORT`; die Web-App hört darauf (`next start -p $PORT`).
- Der Worker öffnet **keinen** Port (kein HTTP-Healthcheck konfigurieren).
- **Der S3-Bucket muss vorab existieren** — die App legt ihn nicht an.
- Web und Worker brauchen **denselben** Env-Satz (beide reden mit DB, Redis,
  Objektspeicher; der Worker rendert zusätzlich mit ffmpeg). Einziger
  Unterschied: `E2R_ROLE`.
- Da beide Dienste dieselben Migrationen sehen: den Worker erst nach dem
  ersten erfolgreichen Web-Deploy hochfahren (oder einfach neu deployen).

## 1a. MinIO-Dienst (Objektspeicher)

Wer kein AWS S3/R2 nutzt, betreibt MinIO als eigenen Railway-Dienst:

- **Build**: Root-Verzeichnis `expose-to-reel-de/deploy/minio` (das Image setzt
  den Start-Befehl `server /data --console-address :9001` fest, weil Railway
  keinen Command setzen kann).
- **Volume**: auf `/data` mounten (sonst sind alle Medien nach dem Redeploy weg).
- **Env**: `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` (werden zu `S3_ACCESS_KEY_ID` /
  `S3_SECRET_ACCESS_KEY` der App).
- **Domain**: öffentliche Domain auf **Port 9000** (S3-API). Port 9001 ist nur die
  Konsole — nicht öffentlich machen.
- **Bucket einmalig anlegen**: über die Konsole oder `mc`:
  ```bash
  mc alias set railway https://<minio-domain> "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
  mc mb railway/expose-to-reel
  ```
- In der App: `S3_ENDPOINT=https://<minio-domain>`, `S3_FORCE_PATH_STYLE=true`.

## 2. Migrationen & erstes Konto

1. **Migrationen laufen automatisch** beim Start des Web-Dienstes
   (`docker-entrypoint.sh` → `prisma migrate deploy`, wendet
   `packages/shared/prisma/migrations/` an). Nichts zu konfigurieren; ein
   Redeploy des Web-Dienstes ist die Migration. Manuell geht auch
   `npm run db:migrate` (One-off-Command).

2. **Einmalig** ein Produktivkonto anlegen (One-off-Command / `railway run`):

   ```
   ADMIN_EMAIL="makler@firma.de" \
   ADMIN_PASSWORD="mindestens-10-zeichen" \
   ORG_NAME="Mustermakler GmbH" \
   npm run db:createuser
   ```
   Idempotent: bestehende Organisation (Name) wird wiederverwendet, der Nutzer
   (E-Mail) wird angelegt oder sein Passwort aktualisiert. Optional `ADMIN_NAME`.
   Das Passwort wird nur gehasht (scrypt) gespeichert und nie geloggt.

> ⚠️ **`npm run db:seed` darf in Produktion NIEMALS laufen.** Der Seed legt den
> öffentlich bekannten Demo-Login `demo@example.com` / `demo1234` an, überschreibt
> die Demo-Organisation und erzeugt Beispiel-Exposés. Für Produktivkonten
> ausschließlich `npm run db:createuser` verwenden.

## 3. Umgebungsvariablen

### Pflicht (Web **und** Worker)

| Variable | Wert / Hinweis |
|---|---|
| `DATABASE_URL` | Postgres-Plugin (`${{Postgres.DATABASE_URL}}`) |
| `REDIS_URL` | Redis-Plugin (`${{Redis.REDIS_URL}}`); Default wäre `redis://localhost:6379` |
| `SESSION_SECRET` | langer Zufallswert; signiert Session-Cookies |
| `CREDENTIALS_ENCRYPTION_KEY` | 32 Byte hex (64 Zeichen): `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `STORAGE_DRIVER` | `s3` (Container-Dateisystem ist flüchtig — `local` ist keine Option) |
| `S3_BUCKET` | Name des **bereits existierenden** Buckets |
| `S3_ACCESS_KEY_ID` | Zugangsschlüssel |
| `S3_SECRET_ACCESS_KEY` | Secret |
| `WEB_BASE_URL` | öffentliche URL des Web-Dienstes, z. B. `https://app.example.de` |
| `E2R_ROLE` | `web` (Default im Image) bzw. `worker` — **nur** beim Worker-Dienst setzen |

### S3-Feinheiten

| Variable | Pflicht? | Wert |
|---|---|---|
| `S3_ENDPOINT` | bei MinIO/R2 | z. B. `https://<account>.r2.cloudflarestorage.com` bzw. MinIO-URL. Leer lassen für AWS S3. |
| `S3_REGION` | optional | Standard `us-east-1` (R2: `auto`) |
| `S3_FORCE_PATH_STYLE` | bei MinIO | `true` (MinIO); für AWS S3/R2 weglassen bzw. `false` |

### Im Image bereits gesetzt (nur bei Bedarf überschreiben)

| Variable | Default im Image |
|---|---|
| `PYTHON_BIN` | `python3` (Debian hat kein `python`) |
| `FFMPEG_FONT_PATH` | `/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf` (End-Cards/Overlays) |
| `FFMPEG_PATH` / `FFPROBE_PATH` | leer → aus dem `PATH` (ffmpeg ist installiert) |
| `NODE_ENV` | `production` |

### Optional — Propstack-Import (CRM)

| Variable | Hinweis |
|---|---|
| `propstack_api_key` | Kleinschreibung ist Absicht. Ohne Key bleibt der Import in der UI deaktiviert. |
| `PROPSTACK_MAX_IMAGES` | max. importierte Fotos pro Objekt (Standard: 20) |
| `DEMO_MODE` | `1` = Propstack-Client schreibgeschützt |

### Optional — KI-Optionen (Opt-in, ohne Schlüssel deaktiviert)

| Variable | Hinweis |
|---|---|
| `LLM_PROVIDER` | `anthropic` (Standard) oder `minimax` |
| `ANTHROPIC_API_KEY` | Pflicht bei `LLM_PROVIDER=anthropic` |
| `MINIMAX_API_KEY` | Pflicht bei `LLM_PROVIDER=minimax` |
| `MINIMAX_BASE_URL` | abweichender Endpunkt (Standard: `https://api.minimax.io/anthropic`) |
| `IMAGE_ANALYSIS_PROVIDER` | `heuristic` (Standard) oder `ai` |
| `LLM_VISION_MODEL` / `LLM_TEXT_MODEL` | Modelle überschreiben |

### Optional — Voiceover & Musik

| Variable | Hinweis |
|---|---|
| `TTS_PROVIDER` | `openai` oder `elevenlabs`; ohne Angabe entscheidet der vorhandene Key |
| `OPENAI_API_KEY` | für `openai` |
| `ELEVENLABS_API_KEY` | für `elevenlabs` |
| `ELEVENLABS_VOICE_ID`, `TTS_MODEL`, `TTS_VOICE` | Feineinstellung |
| `MUSIC_TRACK_PATH` | Pfad zu einer **lizenzierten** Audiodatei im Image/Volume; es wird keine Musik mitgeliefert |

### Optional — Video & Portale

| Variable | Hinweis |
|---|---|
| `VIDEO_PROVIDER` | `foto_motion` (Standard), `mock` (Demo-Wasserzeichen) oder `external` |
| `IS24_IMPORT_ENABLED`, `IS24_PUBLISH_ENABLED`, `APIFY_TOKEN`, `APIFY_IS24_ACTOR_ID`, `IS24_*` | deaktivierte Scaffolds; nur mit autorisierter Verbindung aktivieren |

## 4. Image-Details

- Basis `node:22-bookworm-slim` mit `ffmpeg`/`ffprobe`, `python3` +
  `python3-requests` (Propstack-Bridge), `openssl` (Prisma) und
  `fonts-dejavu-core` (drawtext).
- Dev-Dependencies bleiben bewusst installiert: der Worker startet über `tsx`,
  die Migrationen laufen über die `prisma`-CLI.
- `docker-compose.yml` liegt im Image, weil `resolveFromWorkspaceRoot()` /
  `loadRootEnv()` diese Datei als Workspace-Root-Marker verwenden — ohne sie
  findet die Web-App `services/propstack/fetch_property.py` nicht.
- Rendering läuft im Worker über `os.tmpdir()`; kein persistentes Volume nötig,
  alle Ergebnisse landen im Objektspeicher.
- `docker-entrypoint.sh` ist ENTRYPOINT (POSIX sh, läuft als `node`-User) und
  verzweigt über `E2R_ROLE`.

## 5. Rauchtest nach dem Deploy

```bash
curl -s -o /dev/null -w "%{http_code}\n" "$WEB_BASE_URL/login"   # 200
```
Web-Log muss zeigen: `[entrypoint] Starte Rolle: web` → `prisma migrate deploy`
→ `✓ Ready`.
Worker-Log muss zeigen: `[entrypoint] Starte Rolle: worker` →
`[worker] Bereit — Queue "video-generation" auf …`.
Danach: einloggen, Projekt anlegen, Fotos hochladen, Video generieren.
