/** @type {import('next').NextConfig} */
const nextConfig = {
  // IMPORTANT: do not static-export
  output: undefined,

  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },

  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },

  // Force Next/Vercel to include occt-import-js dist assets (including .wasm) in the API bundle.
  // NOTE: keys here are route patterns used by Next's output file tracing.
  outputFileTracingIncludes: {
    "/api/cad-preview": ["node_modules/occt-import-js/dist/**"],
  },
};

module.exports = nextConfig;

