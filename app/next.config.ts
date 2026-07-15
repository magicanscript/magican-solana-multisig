import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack (дефолт в Next 16) не резолвит файлы выше project-root, а root
  // автодетектится по lockfile → стал бы app/. Поднимаем до корня монорепо,
  // иначе alias @generated → ../clients/js/src/generated не разрешится.
  turbopack: { root: path.join(__dirname, "..") },
  // framework-kit и наш Codama-клиент (TS-исходники) требуют транспиляции.
  transpilePackages: ["@solana/kit", "@solana/client", "@solana/react-hooks"],
};

export default nextConfig;
