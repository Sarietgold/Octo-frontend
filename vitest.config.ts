import { defineConfig } from "vitest/config";
import path from "path";

// Configure Vitest for unit tests while excluding Playwright e2e test suite.
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["**/node_modules/**", "**/e2e/**"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
