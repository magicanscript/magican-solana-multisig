import path from "node:path";
import { defineConfig } from "vitest/config";

// Vitest не читает paths из tsconfig — дублируем алиасы явно.
export default defineConfig({
  resolve: {
    alias: {
      "@generated": path.resolve(__dirname, "../clients/js/src/generated"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
