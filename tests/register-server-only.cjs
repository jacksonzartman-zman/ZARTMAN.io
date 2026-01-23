/**
 * Test-only shim for Next's `server-only` module.
 *
 * In real Next.js builds, `import "server-only"` is handled by the framework.
 * In plain Node (our `tsx` tests), resolving the real module either fails
 * (module not found) or throws (if the package is installed).
 *
 * This hook makes `server-only` a no-op so server utilities can be tested.
 */
const Module = require("node:module");

const originalLoad = Module._load;

Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

