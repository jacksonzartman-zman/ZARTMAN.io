import assert from "node:assert";

(async () => {
  const originalEnv = { ...process.env };
  const originalConsoleDebug = console.debug;

  try {
    // Silence debugOnce output in this test.
    console.debug = () => {};

    const { isDemoModeEnabled } = await import("../src/server/demo/demoMode");

    const setEnv = (values: Record<string, string | undefined>) => {
      for (const [key, value] of Object.entries(values)) {
        if (typeof value === "undefined") {
          delete (process.env as any)[key];
        } else {
          (process.env as any)[key] = value;
        }
      }
    };

    // Vercel Preview: NODE_ENV is "production" but VERCEL_ENV is "preview".
    setEnv({ DEMO_MODE: "true", NODE_ENV: "production", VERCEL_ENV: "preview" });
    assert.strictEqual(
      isDemoModeEnabled(),
      true,
      "Expected demo enabled in Vercel Preview when DEMO_MODE=true",
    );

    // Vercel Production: always disabled even if flag set.
    setEnv({ DEMO_MODE: "true", NODE_ENV: "production", VERCEL_ENV: "production" });
    assert.strictEqual(
      isDemoModeEnabled(),
      false,
      "Expected demo disabled in Vercel production regardless of DEMO_MODE",
    );

    // Non-Vercel production safety: VERCEL_ENV missing, NODE_ENV=production disables.
    setEnv({ DEMO_MODE: "true", NODE_ENV: "production", VERCEL_ENV: undefined });
    assert.strictEqual(
      isDemoModeEnabled(),
      false,
      "Expected demo disabled when NODE_ENV=production and VERCEL_ENV is unset",
    );

    // Flag off: always disabled.
    setEnv({ DEMO_MODE: "false", NODE_ENV: "development", VERCEL_ENV: "preview" });
    assert.strictEqual(isDemoModeEnabled(), false, "Expected demo disabled when flag is false");

    console.log("demoModeEnabled tests passed");
  } finally {
    process.env = originalEnv;
    console.debug = originalConsoleDebug;
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

