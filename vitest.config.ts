import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    testTimeout: 10000,
    // Each worker thread gets its own in-memory SQLite DB — avoids SQLITE_BUSY
    // lock contention when multiple workers hit db.pragma() simultaneously.
    env: {
      DATABASE_PATH: ":memory:",
    },
  },
});
