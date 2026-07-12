import path from "node:path";
import { defineConfig } from "vitest/config";

const sharedSrc = path.resolve(__dirname, "../../packages/shared/src");

export default defineConfig({
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "src") },
      { find: /^@e2r\/shared$/, replacement: path.join(sharedSrc, "index.ts") },
      { find: /^@e2r\/shared\/(.*)$/, replacement: `${sharedSrc}/$1.ts` },
    ],
  },
  test: {
    name: "integration-web",
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
