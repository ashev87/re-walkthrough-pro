/** Gemeinsame Queue-Definitionen für Web-App (Producer) und Worker (Consumer). */

export const GENERATION_QUEUE_NAME = "video-generation";

export interface GenerationJobPayload {
  generationJobId: string;
  projectId: string;
  organizationId: string;
}

export const GENERATION_JOB_ATTEMPTS = 2;
export const GENERATION_JOB_BACKOFF_MS = 5000;

/**
 * REDIS_URL → BullMQ-Verbindungsoptionen. Optionen statt Client-Instanz,
 * damit BullMQ seine eigene ioredis-Version nutzt (keine Typ-/Versionskonflikte).
 */
export function redisConnectionOptions(redisUrl: string): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db: number;
  maxRetriesPerRequest: null;
} {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    ...(url.username ? { username: url.username } : {}),
    ...(url.password ? { password: url.password } : {}),
    db:
      url.pathname && url.pathname !== "/" ? Number(url.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
  };
}
