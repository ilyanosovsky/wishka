import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Every data-access suite boots its own in-memory Postgres in `beforeAll`
    // and replays the whole migration history into it. Several of those files
    // run in parallel, so the default 10s hook budget is not about any single
    // test being slow — it is about CPU contention on a 2-core CI runner.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
