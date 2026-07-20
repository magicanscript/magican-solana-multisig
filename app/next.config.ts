import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack (the default in Next 16) won't resolve files above the project root,
  // and the root is auto-detected from the lockfile → it would end up being app/.
  // We raise it to the monorepo root, otherwise the alias
  // @generated → ../clients/js/src/generated cannot be resolved.
  turbopack: { root: path.join(__dirname, "..") },
  // framework-kit and our Codama client (TS sources) need transpiling.
  transpilePackages: ["@solana/kit", "@solana/client", "@solana/react-hooks"],
};

export default nextConfig;
