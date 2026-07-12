import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { hmacSign } from "../crypto";
import { env } from "../env";
import {
  type ObjectStorage,
  SIGNED_URL_DEFAULT_TTL,
} from "./types";

/**
 * Lokaler Entwicklungs-Storage. Dateien liegen unter STORAGE_LOCAL_DIR;
 * signierte URLs laufen über die Web-App (/api/storage/…) und werden dort
 * HMAC-geprüft — Quellmedien sind nie direkt öffentlich erreichbar.
 */
export class LocalObjectStorage implements ObjectStorage {
  constructor(private readonly baseDir: string = env.storageLocalDir) {}

  private resolve(key: string): string {
    const safe = path.normalize(key).replace(/^([/\\.])+/, "");
    const full = path.resolve(this.baseDir, safe);
    const base = path.resolve(this.baseDir);
    if (!full.startsWith(base + path.sep) && full !== base) {
      throw new Error(`Unzulässiger Storage-Key: ${key}`);
    }
    return full;
  }

  async put(key: string, data: Buffer, _contentType: string): Promise<void> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    await rm(this.resolve(prefix), { recursive: true, force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async getSignedUrl(
    key: string,
    expiresInSeconds: number = SIGNED_URL_DEFAULT_TTL
  ): Promise<string> {
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const signature = signLocalStorageUrl(key, expires);
    const params = new URLSearchParams({
      exp: String(expires),
      sig: signature,
    });
    return `${env.webBaseUrl}/api/storage/${encodeURI(key)}?${params}`;
  }

  /** Absoluter Dateipfad (nur für Worker/ffmpeg auf derselben Maschine). */
  filePath(key: string): string {
    return this.resolve(key);
  }
}

export function signLocalStorageUrl(key: string, expiresEpoch: number): string {
  return hmacSign(`storage:${key}:${expiresEpoch}`);
}
