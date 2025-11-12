/** @type {import('next').NextConfig} */
const nextConfig = {
  // IMPORTANT: do not static-export
  output: undefined,
  images: { unoptimized: true },   // OK on Pages
  eslint: { ignoreDuringBuilds: true },
  experimental: {}                 // leave empty (no 'output: export')
};

module.exports = nextConfig;
