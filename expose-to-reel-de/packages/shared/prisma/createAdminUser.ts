import { loadRootEnv } from "../src/loadEnv";

loadRootEnv();

import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/crypto";

/**
 * Produktiv-Konto anlegen (Ersatz für den Demo-Seed).
 *
 * Der Seed (`npm run db:seed`) legt demo@example.com/demo1234 an und darf in
 * Produktion NIEMALS laufen. Dieses Skript erzeugt stattdessen idempotent eine
 * Organisation und einen Nutzer aus der Umgebung:
 *
 *   ADMIN_EMAIL=… ADMIN_PASSWORD=… ORG_NAME="…" npm run db:createuser
 *
 * Optional: ADMIN_NAME (Standard: lokaler Teil der E-Mail).
 * Das Passwort wird nur gehasht gespeichert und niemals geloggt.
 */

const MIN_PASSWORD_LENGTH = 10;

const prisma = new PrismaClient();

interface AdminInput {
  email: string;
  password: string;
  orgName: string;
  name: string;
}

/** Liest und validiert die Eingaben; wirft mit klarer deutscher Meldung. */
export function readAdminInput(source: NodeJS.ProcessEnv): AdminInput {
  const email = (source.ADMIN_EMAIL ?? "").trim();
  const password = source.ADMIN_PASSWORD ?? "";
  const orgName = (source.ORG_NAME ?? "").trim();

  const missing = [
    email ? null : "ADMIN_EMAIL",
    password ? null : "ADMIN_PASSWORD",
    orgName ? null : "ORG_NAME",
  ].filter((name): name is string => name !== null);
  if (missing.length > 0) {
    throw new Error(
      `Fehlende Umgebungsvariablen: ${missing.join(", ")} — ` +
        'Aufruf: ADMIN_EMAIL=… ADMIN_PASSWORD=… ORG_NAME="…" npm run db:createuser'
    );
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error(`ADMIN_EMAIL ist keine gültige E-Mail-Adresse: ${email}`);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `ADMIN_PASSWORD ist zu kurz — mindestens ${MIN_PASSWORD_LENGTH} Zeichen erforderlich.`
    );
  }

  const name = (source.ADMIN_NAME ?? "").trim() || email.split("@")[0]!;
  return { email, password, orgName, name };
}

async function main(): Promise<void> {
  const input = readAdminInput(process.env);

  // Organization.name ist nicht unique → findFirst statt upsert.
  const existingOrg = await prisma.organization.findFirst({
    where: { name: input.orgName },
  });
  const organization =
    existingOrg ??
    (await prisma.organization.create({ data: { name: input.orgName } }));

  const user = await prisma.user.upsert({
    where: { email: input.email },
    update: {
      name: input.name,
      passwordHash: hashPassword(input.password),
      organizationId: organization.id,
    },
    create: {
      email: input.email,
      name: input.name,
      passwordHash: hashPassword(input.password),
      organizationId: organization.id,
    },
  });

  console.info(
    `[createuser] Organisation: ${organization.name} (${organization.id})` +
      `${existingOrg ? " — vorhanden" : " — neu angelegt"}`
  );
  console.info(`[createuser] Nutzer: ${user.email} (${user.id}) — Passwort gesetzt.`);
}

main()
  .catch((error) => {
    console.error(
      "[createuser] Fehler:",
      error instanceof Error ? error.message : error
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
