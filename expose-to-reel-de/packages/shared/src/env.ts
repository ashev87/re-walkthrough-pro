import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Zentrale, validierte Umgebungskonfiguration.
 * Secrets werden hier gelesen, aber niemals geloggt.
 */

/**
 * Relative Datenpfade werden am Monorepo-Root verankert (Marker:
 * docker-compose.yml), damit Web (CWD apps/web), Worker (CWD apps/worker)
 * und Seeds (CWD Root) denselben lokalen Speicher verwenden.
 */
export function resolveFromWorkspaceRoot(relative: string): string {
  if (path.isAbsolute(relative)) return relative;
  let current = process.cwd();
  for (;;) {
    if (existsSync(path.join(current, "docker-compose.yml"))) {
      return path.join(current, relative);
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(process.cwd(), relative);
    current = parent;
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Fehlende Umgebungsvariable: ${name} (siehe .env.example)`);
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function flag(name: string): boolean {
  return (process.env[name] ?? "").toLowerCase() === "true";
}

export const env = {
  get databaseUrl(): string {
    return required("DATABASE_URL");
  },
  get redisUrl(): string {
    return optional("REDIS_URL", "redis://localhost:6379");
  },
  get sessionSecret(): string {
    return required("SESSION_SECRET");
  },
  get credentialsEncryptionKey(): string {
    return required("CREDENTIALS_ENCRYPTION_KEY");
  },
  get storageDriver(): "local" | "s3" {
    const driver = optional("STORAGE_DRIVER", "local");
    if (driver !== "local" && driver !== "s3") {
      throw new Error(`Ungültiger STORAGE_DRIVER: ${driver}`);
    }
    return driver;
  },
  get storageLocalDir(): string {
    return resolveFromWorkspaceRoot(
      optional("STORAGE_LOCAL_DIR", ".data/storage")
    );
  },
  s3: {
    get endpoint(): string {
      return optional("S3_ENDPOINT");
    },
    get region(): string {
      return optional("S3_REGION", "us-east-1");
    },
    get bucket(): string {
      return required("S3_BUCKET");
    },
    get accessKeyId(): string {
      return required("S3_ACCESS_KEY_ID");
    },
    get secretAccessKey(): string {
      return required("S3_SECRET_ACCESS_KEY");
    },
    get forcePathStyle(): boolean {
      return flag("S3_FORCE_PATH_STYLE");
    },
  },
  get ffmpegPath(): string {
    return optional("FFMPEG_PATH") || "ffmpeg";
  },
  get ffprobePath(): string {
    return optional("FFPROBE_PATH") || "ffprobe";
  },
  get ffmpegFontPath(): string {
    return optional("FFMPEG_FONT_PATH");
  },
  get webBaseUrl(): string {
    return optional("WEB_BASE_URL", "http://localhost:3000");
  },
  get is24ImportEnabled(): boolean {
    return flag("IS24_IMPORT_ENABLED");
  },
  get is24PublishEnabled(): boolean {
    return flag("IS24_PUBLISH_ENABLED");
  },
  get apifyToken(): string {
    return optional("APIFY_TOKEN");
  },
  get apifyIs24ActorId(): string {
    return optional("APIFY_IS24_ACTOR_ID");
  },
  get imageAnalysisProvider(): string {
    return optional("IMAGE_ANALYSIS_PROVIDER", "heuristic");
  },
  get videoProvider(): string {
    return optional("VIDEO_PROVIDER", "mock");
  },
};
