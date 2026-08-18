import { defineConfig } from "vitest/config";

// lib/ credibility core is pure and must be testable without a browser or a
// live model (CLAUDE.md: "unit-test the sanity-check layer and Zod schemas first").
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
