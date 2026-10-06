import { defineConfig } from "vitest/config";
import path from "node:path";

// Mirror tsconfig's "@/*" → "src/*" mapping so server modules (which use the
// alias) resolve under vitest as well as under next/tsc.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(process.cwd(), "src") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
