/** @type {import('next').NextConfig} */
const nextConfig = {
  // IMPORTANT: do not static-export
  output: undefined,
  images: { unoptimized: true },   // OK on Pages
  eslint: { ignoreDuringBuilds: true },
  outputFileTracingIncludes: {
    // Ensure the occt-import-js wasm is packaged for API route handlers (Vercel).
    // Next may match these globs against internal "app/..." paths (even when using `src/app`),
    // so we include both forms to be safe across Next versions.
    "app/api/cad-preview/route": [
      "./node_modules/occt-import-js/dist/occt-import-js.wasm",
      "./node_modules/occt-import-js/dist/occt-import-js.js",
    ],
    "app/api/**": [
      "node_modules/occt-import-js/dist/occt-import-js.wasm",
      "node_modules/occt-import-js/dist/occt-import-js.js",
    ],
    "src/app/api/**": [
      "node_modules/occt-import-js/dist/occt-import-js.wasm",
      "node_modules/occt-import-js/dist/occt-import-js.js",
    ],
  },
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
