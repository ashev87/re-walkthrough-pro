#!/bin/sh
# ---------------------------------------------------------------------------
# Rollen-Einstiegspunkt für das gemeinsame Image (Web + Worker).
#
# Railway kann pro Dienst weder einen Start-Befehl noch ein Pre-Deploy-Command
# über die CLI setzen — die Rolle kommt daher aus der Umgebungsvariable
# E2R_ROLE, und die Migrationen laufen beim Start des Web-Dienstes mit.
#
#   E2R_ROLE=web    (Standard) → Prisma-Migrationen + Next-Server auf $PORT
#   E2R_ROLE=worker           → BullMQ-Worker (keine Migrationen)
# ---------------------------------------------------------------------------
set -eu

ROLE="${E2R_ROLE:-web}"
echo "[entrypoint] Starte Rolle: ${ROLE}"

case "${ROLE}" in
  web)
    echo "[entrypoint] Wende Datenbank-Migrationen an (prisma migrate deploy)…"
    # Kein Fehler-Schlucken: schlägt die Migration fehl, startet der Container nicht.
    npx prisma migrate deploy --schema packages/shared/prisma/schema.prisma
    echo "[entrypoint] Migrationen ok — starte Web-App auf Port ${PORT:-3000}."
    exec npm run start --workspace apps/web -- -p "${PORT:-3000}"
    ;;
  worker)
    exec npm run start --workspace apps/worker
    ;;
  *)
    echo "[entrypoint] Unbekannte Rolle: '${ROLE}' — erlaubt sind 'web' oder 'worker' (E2R_ROLE)." >&2
    exit 1
    ;;
esac
