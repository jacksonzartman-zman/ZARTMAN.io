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
  // Avoid bundling `occt-import-js` (and its `.wasm`) into the Next.js server build.
  serverExternalPackages: ["occt-import-js"],
  webpack: (config, { isServer }) => {
    if (isServer) {
      const existing = config.externals ?? [];
      config.externals = [
        ...(Array.isArray(existing) ? existing : [existing]),
        function occtImportJsExternal() {
          // Support both webpack externals signatures:
          // - (data, callback) where data = { context, request, ... }
          // - (context, request, callback)
          const callback = arguments[arguments.length - 1];
          const request = typeof arguments[1] === "string" ? arguments[1] : arguments[0]?.request;
          if (typeof request === "string" && (request === "occt-import-js" || request.startsWith("occt-import-js/"))) {
            return callback(null, `commonjs ${request}`);
          }
          return callback();
        },
      ];
    }
    return config;
  },
};

module.exports = nextConfig;
