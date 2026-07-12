import { loadRootEnv } from "@e2r/shared/loadEnv";

loadRootEnv();

import {
  env,
  GENERATION_QUEUE_NAME,
  redisConnectionOptions,
  type GenerationJobPayload,
} from "@e2r/shared";
import { Worker } from "bullmq";
import { processGenerationJob } from "./pipeline/processJob";

/**
 * Hintergrund-Worker für Video-Generierungsjobs.
 * Start: npm run dev:worker (Redis aus docker compose erforderlich).
 */

const connection = redisConnectionOptions(env.redisUrl);

const worker = new Worker<GenerationJobPayload>(
  GENERATION_QUEUE_NAME,
  async (job) => {
    console.info(
      `[worker] Starte Generierung ${job.data.generationJobId} (Projekt ${job.data.projectId})`
    );
    await processGenerationJob(job.data.generationJobId, {
      onProgress: async (percent, step) => {
        await job.updateProgress({ percent, step });
      },
    });
    console.info(`[worker] Fertig: ${job.data.generationJobId}`);
  },
  {
    connection,
    concurrency: 1, // ffmpeg ist CPU-gebunden; ein Job zur Zeit
  }
);

worker.on("failed", (job, error) => {
  console.error(`[worker] Job ${job?.id} fehlgeschlagen:`, error.message);
});
worker.on("error", (error) => {
  console.error("[worker] Fehler:", error);
});

console.info(
  `[worker] Bereit — Queue "${GENERATION_QUEUE_NAME}" auf ${env.redisUrl}`
);

async function shutdown(): Promise<void> {
  console.info("[worker] Beende…");
  await worker.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
