import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Skip ESLint during builds on platforms where running the full
  // lint step is problematic (CI/build runners). We still install
  // ESLint as a devDependency and provide configs for local linting.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
