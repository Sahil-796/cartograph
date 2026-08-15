import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Fixture repos under test/fixtures contain files that look like
    // tests (*.test.ts, *.spec.tsx) by design — they exercise walk.ts's
    // test-detection convention and must not be collected as real
    // vitest suites themselves.
    exclude: ["**/node_modules/**", "**/test/fixtures/**"],
  },
});
