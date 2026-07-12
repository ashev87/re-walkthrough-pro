import nextEnv from "@next/env";
import path from "node:path";
import { fileURLToPath } from "node:url";

// .env liegt am Monorepo-Root (nicht in apps/web) — explizit laden.
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
nextEnv.loadEnvConfig(workspaceRoot);

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@e2r/shared"],
  serverExternalPackages: ["@prisma/client", "bullmq", "ioredis"],
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
