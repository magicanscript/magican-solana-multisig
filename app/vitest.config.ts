import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Vitest не читает paths из tsconfig — дублируем алиасы явно.
export default defineConfig({
  // JSX в тестах компонентов: tsconfig Next'а держит `jsx: "preserve"` (транспиляция —
  // забота сборщика), поэтому esbuild сам по себе .tsx-тест не соберёт.
  plugins: [react()],
  resolve: {
    alias: {
      "@generated": path.resolve(__dirname, "../clients/js/src/generated"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // По умолчанию node — он быстрее и честнее для чистых модулей. Тесты компонентов
    // просят jsdom построчно: `// @vitest-environment jsdom` в первой строке файла.
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
