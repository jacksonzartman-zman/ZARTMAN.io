/** @type {import('next').NextConfig} */
const nextConfig = {
  // IMPORTANT: do not static-export
  output: undefined,
  images: { unoptimized: true },   // OK on Pages
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },                 // keep default output (no 'output: export')
};

module.exports = nextConfig;
