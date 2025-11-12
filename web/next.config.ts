/** @type {import('next').NextConfig} */
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // DO NOT set output: 'export'
  images: { unoptimized: true }, // fine for Pages
  experimental: {
    // ok to leave empty; your route handlers can set runtime = 'edge'
  },
};

export default nextConfig;
