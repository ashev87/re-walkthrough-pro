import type { Prisma, PrismaClient } from "@prisma/client";

export interface AuditInput {
  organizationId: string;
  projectId?: string | null;
  userId?: string | null;
  type: string;
  data?: Prisma.InputJsonValue;
}

type Db = PrismaClient | Prisma.TransactionClient;

/** Schreibt ein Audit-Ereignis; Fehler dürfen den Hauptpfad nicht brechen. */
export async function recordAudit(db: Db, input: AuditInput): Promise<void> {
  try {
    await db.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        projectId: input.projectId ?? null,
        userId: input.userId ?? null,
        type: input.type,
        data: input.data,
      },
    });
  } catch (error) {
    console.error("[audit] Ereignis konnte nicht gespeichert werden:", error);
  }
}
