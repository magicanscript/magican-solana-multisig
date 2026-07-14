import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // framework-kit и наш Codama-клиент (TS-исходники) требуют транспиляции.
  transpilePackages: ["@solana/kit", "@solana/client", "@solana/react-hooks"],
};

export default nextConfig;
