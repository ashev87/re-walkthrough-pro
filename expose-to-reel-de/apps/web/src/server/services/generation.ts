import {
  env,
  GENERATION_JOB_ATTEMPTS,
  GENERATION_JOB_BACKOFF_MS,
  GENERATION_QUEUE_NAME,
  prisma,
  recordAudit,
  redisConnectionOptions,
} from "@e2r/shared";
import { Queue } from "bullmq";
import { ApiError } from "../api";
import type { SessionUser } from "../session";
import { transitionOrConflict } from "./projects";

/** Generierungsjobs: Start (idempotent), Status, Abbruch, Retry. */

declare global {
  var __e2rQueue: Queue | undefined;
}

function getQueue(): Queue {
  if (!globalThis.__e2rQueue) {
    globalThis.__e2rQueue = new Queue(GENERATION_QUEUE_NAME, {
      connection: redisConnectionOptions(env.redisUrl),
    });
  }
  return globalThis.__e2rQueue;
}

export async function startGeneration(
  user: SessionUser,
  projectId: string,
  idempotencyKey: string | null
) {
  const project = await prisma.propertyProject.findFirst({
    where: { id: projectId, organizationId: user.organizationId },
  });
  if (!project) throw new ApiError(404, "Projekt nicht gefunden.");

  // Idempotenz: gleicher Schlüssel ⇒ vorhandenen Job zurückgeben.
  if (idempotencyKey) {
    const existing = await prisma.generationJob.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      if (existing.projectId !== projectId) {
        throw new ApiError(
          409,
          "Idempotency-Key wurde bereits für ein anderes Projekt verwendet."
        );
      }
      return { job: existing, reused: true };
    }
  }

  transitionOrConflict(project.status, "GENERATING");

  const selectedShots = await prisma.shot.count({
    where: { projectId, selected: true },
  });
  if (selectedShots === 0) {
    throw new ApiError(
      422,
      "Keine ausgewählten Shots — bitte zuerst die Shotliste erstellen."
    );
  }

  const job = await prisma.generationJob.create({
    data: { projectId, idempotencyKey, status: "QUEUED" },
  });
  await prisma.propertyProject.update({
    where: { id: projectId },
    data: { status: "GENERATING" },
  });
  await prisma.shot.updateMany({
    where: { projectId },
    data: { status: "PENDING", errorMessage: null },
  });

  try {
    const queueJob = await getQueue().add(
      "generate",
      {
        generationJobId: job.id,
        projectId,
        organizationId: user.organizationId,
      },
      {
        jobId: job.id,
        attempts: GENERATION_JOB_ATTEMPTS,
        backoff: { type: "fixed", delay: GENERATION_JOB_BACKOFF_MS },
        removeOnComplete: 100,
        removeOnFail: 100,
      }
    );
    await prisma.generationJob.update({
      where: { id: job.id },
      data: { queueJobId: queueJob.id },
    });
  } catch (error) {
    console.error("[generation] Enqueue fehlgeschlagen:", error);
    await prisma.generationJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errorMessage: "Job-Queue nicht erreichbar (läuft Redis / docker compose?).",
      },
    });
    await prisma.propertyProject.update({
      where: { id: projectId },
      data: { status: "FAILED" },
    });
    throw new ApiError(
      503,
      "Job-Queue nicht erreichbar (läuft Redis / docker compose?)."
    );
  }

  await recordAudit(prisma, {
    organizationId: user.organizationId,
    projectId,
    userId: user.id,
    type: "generation.started",
    data: { generationJobId: job.id },
  });
  return {
    job: await prisma.generationJob.findUniqueOrThrow({ where: { id: job.id } }),
    reused: false,
  };
}

export async function getGenerationStatus(
  user: SessionUser,
  projectId: string,
  jobId: string
) {
  const job = await prisma.generationJob.findFirst({
    where: {
      id: jobId,
      projectId,
      project: { organizationId: user.organizationId },
    },
    include: {
      project: { select: { status: true } },
      videoVersions: { select: { id: true, version: true } },
    },
  });
  if (!job) throw new ApiError(404, "Job nicht gefunden.");
  const shots = await prisma.shot.findMany({
    where: { projectId },
    orderBy: { sortIndex: "asc" },
    select: {
      id: true,
      roomLabel: true,
      sortIndex: true,
      selected: true,
      status: true,
      errorMessage: true,
    },
  });
  return { job, shots };
}

export async function cancelGeneration(
  user: SessionUser,
  projectId: string,
  jobId: string
) {
  const job = await prisma.generationJob.findFirst({
    where: {
      id: jobId,
      projectId,
      project: { organizationId: user.organizationId },
    },
  });
  if (!job) throw new ApiError(404, "Job nicht gefunden.");
  if (job.status !== "QUEUED" && job.status !== "RUNNING") {
    throw new ApiError(409, "Job läuft nicht mehr und kann nicht abgebrochen werden.");
  }

  await prisma.generationJob.update({
    where: { id: jobId },
    data: { cancelRequested: true },
  });

  // Noch nicht gestarteter Job: direkt aus der Queue entfernen und beenden.
  if (job.status === "QUEUED") {
    try {
      const queueJob = await getQueue().getJob(job.queueJobId ?? jobId);
      if (queueJob) {
        const state = await queueJob.getState();
        if (state === "waiting" || state === "delayed") {
          await queueJob.remove();
          await prisma.$transaction([
            prisma.generationJob.update({
              where: { id: jobId },
              data: { status: "CANCELLED", finishedAt: new Date() },
            }),
            prisma.propertyProject.update({
              where: { id: projectId },
              data: { status: "NEEDS_REVIEW" },
            }),
          ]);
        }
      }
    } catch (error) {
      console.warn("[generation] Queue-Abbruch fehlgeschlagen:", error);
    }
  }

  await recordAudit(prisma, {
    organizationId: user.organizationId,
    projectId,
    userId: user.id,
    type: "generation.cancelRequested",
    data: { generationJobId: jobId },
  });
  return prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
}
