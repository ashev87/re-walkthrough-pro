/** Test-Umgebung: deterministische Secrets (nur für Tests). */
process.env.SESSION_SECRET ??= "test-session-secret";
process.env.CREDENTIALS_ENCRYPTION_KEY ??=
  "8f3a1c5e7b9d2f4a6c8e0b1d3f5a7c9e2b4d6f8a0c1e3b5d7f9a1c3e5b7d9f0a";
process.env.STORAGE_DRIVER ??= "local";
