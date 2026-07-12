import path from "node:path";

/** Benötigt lokale Infrastruktur: docker compose up -d && npm run db:migrate */
process.env.SESSION_SECRET ??= "test-session-secret";
process.env.CREDENTIALS_ENCRYPTION_KEY ??=
  "8f3a1c5e7b9d2f4a6c8e0b1d3f5a7c9e2b4d6f8a0c1e3b5d7f9a1c3e5b7d9f0a";
process.env.DATABASE_URL ??=
  "postgresql://e2r:e2r_dev_password@localhost:5432/expose_to_reel";
process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_LOCAL_DIR ??= path.resolve(
  __dirname,
  "../../../.data/test-storage"
);
process.env.VIDEO_PROVIDER = "mock";
