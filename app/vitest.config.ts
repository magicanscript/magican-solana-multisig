import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Vitest doesn't read paths from tsconfig — we duplicate the aliases explicitly.
export default defineConfig({
  // JSX in component tests: Next's tsconfig keeps `jsx: "preserve"` (transpilation is
  // the bundler's job), so esbuild on its own won't build a .tsx test.
  plugins: [react()],
  resolve: {
    alias: {
      "@generated": path.resolve(__dirname, "../clients/js/src/generated"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // node by default — it's faster and more honest for pure modules. Component tests
    // ask for jsdom per file: `// @vitest-environment jsdom` on the first line of the file.
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
