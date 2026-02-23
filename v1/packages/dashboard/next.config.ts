import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "@mecha/process",
    "@mecha/core",
  ],
};

export default nextConfig;
