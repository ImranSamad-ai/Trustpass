import { defineConfig } from "vitest/config";

// Only the backend's own tests. The plugin (./plugin) is a separate project
// with its own test runner (node:test via tsx).
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
