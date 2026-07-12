import { PrismaClient } from "@prisma/client";

declare global {
  var __e2rPrisma: PrismaClient | undefined;
}

/** Prisma-Singleton (überlebt Next.js Hot-Reloads in der Entwicklung). */
export const prisma: PrismaClient =
  globalThis.__e2rPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__e2rPrisma = prisma;
}
