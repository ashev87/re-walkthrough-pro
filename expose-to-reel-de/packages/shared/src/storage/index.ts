import { env } from "../env";
import { LocalObjectStorage } from "./local";
import { S3ObjectStorage } from "./s3";
import type { ObjectStorage } from "./types";

let instance: ObjectStorage | undefined;

/** Storage-Factory laut STORAGE_DRIVER (local | s3). */
export function getStorage(): ObjectStorage {
  if (!instance) {
    instance =
      env.storageDriver === "s3"
        ? new S3ObjectStorage()
        : new LocalObjectStorage();
  }
  return instance;
}

export * from "./types";
export { LocalObjectStorage, signLocalStorageUrl } from "./local";
export { S3ObjectStorage } from "./s3";
