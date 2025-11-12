/** @type {import('next').NextConfig} */
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // IMPORTANT: do not static-export
  output: undefined,
  images: { unoptimized: true }, // fine for Pages
  eslint: { ignoreDuringBuilds: true }, // avoids ESLint halting server output
  experimental: {
    // ok to leave empty; your route handlers can set runtime = 'edge'
  },
};

export default nextConfig;
