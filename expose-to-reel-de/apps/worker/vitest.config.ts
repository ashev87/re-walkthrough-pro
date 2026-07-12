import path from "node:path";
import { defineConfig } from "vitest/config";

const sharedSrc = path.resolve(__dirname, "../../packages/shared/src");

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@e2r\/shared$/, replacement: path.join(sharedSrc, "index.ts") },
      { find: /^@e2r\/shared\/(.*)$/, replacement: `${sharedSrc}/$1.ts` },
    ],
  },
  test: {
    name: "integration-worker",
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 300_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
