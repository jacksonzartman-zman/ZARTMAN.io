import assert from "node:assert";

// Simulate a browser environment and ensure we fail fast with a clear error.
// Note: this is intentionally a runtime check; Next.js should also prevent
// a Client Component from importing this module via `import "server-only"`.
(async () => {
  const originalWindow = (globalThis as any).window;
  try {
    (globalThis as any).window = {};

    let threw = false;
    try {
      await import("../src/lib/supabaseServer");
    } catch (err) {
      threw = true;
      const msg = err instanceof Error ? err.message : String(err);
      assert.strictEqual(
        msg,
        "supabase admin client imported into client bundle",
        "Expected clear guard error message",
      );
    }

    assert.strictEqual(
      threw,
      true,
      "Import should throw in a browser-like env",
    );
    console.log("supabaseAdminClientGuard tests passed");
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = originalWindow;
    }
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

