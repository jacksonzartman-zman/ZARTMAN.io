/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },   // OK on Pages
  experimental: {}                 // leave empty (no 'output: export')
};

module.exports = nextConfig;
