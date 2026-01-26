import assert from "node:assert";

(async () => {
  const originalEnv = { ...process.env };

  try {
    const { buildAuthCallbackRedirectTo, getRequestOrigin } = await import(
      "../src/server/requestOrigin"
    );

    const h = (headers: Record<string, string | undefined>) =>
      ({
        get(name: string) {
          const key = name.toLowerCase();
          for (const [k, v] of Object.entries(headers)) {
            if (k.toLowerCase() === key) return v ?? null;
          }
          return null;
        },
      }) as { get(name: string): string | null };

    // Vercel-style forwarded headers should win.
    assert.strictEqual(
      getRequestOrigin(
        h({
          "x-forwarded-proto": "https",
          "x-forwarded-host": "my-preview-123.vercel.app",
          origin: "https://ignored.example.com",
        }),
      ),
      "https://my-preview-123.vercel.app",
    );

    // An explicitly provided (and allowlisted) client origin should win.
    {
      const clientOrigin = "https://zartman-abc-jackson-zartmans-projects.vercel.app";
      const origin = getRequestOrigin(
        h({
          "x-forwarded-proto": "https",
          "x-forwarded-host": "some-other-host.example.com",
        }),
        { clientOrigin },
      );
      assert.strictEqual(origin, clientOrigin);
      const { redirectTo } = buildAuthCallbackRedirectTo({
        origin,
        nextPath: "/",
      });
      assert.ok(redirectTo.startsWith(`${clientOrigin}/auth/callback?next=`));
    }

    // Invalid client origin should be ignored and fall back to headers/env (no throw).
    assert.strictEqual(
      getRequestOrigin(
        h({
          "x-forwarded-proto": "https",
          "x-forwarded-host": "my-preview-456.vercel.app",
        }),
        { clientOrigin: "https://evil.com" },
      ),
      "https://my-preview-456.vercel.app",
    );

    // Comma-delimited forwarded values: pick the first.
    assert.strictEqual(
      getRequestOrigin(
        h({
          "x-forwarded-proto": "https, http",
          "x-forwarded-host": "a.example.com, b.example.com",
        }),
      ),
      "https://a.example.com",
    );

    // Fallback: Origin header.
    assert.strictEqual(
      getRequestOrigin(
        h({
          origin: "http://localhost:3000",
        }),
      ),
      "http://localhost:3000",
    );

    // Fallback: Referer.
    assert.strictEqual(
      getRequestOrigin(
        h({
          referer: "https://foo.example.com/some/path?x=1",
        }),
      ),
      "https://foo.example.com",
    );

    // Fallback: NEXT_PUBLIC_SITE_URL (trim trailing slash).
    process.env.NEXT_PUBLIC_SITE_URL = "https://prod.example.com/";
    delete (process.env as any).VERCEL_URL;
    assert.strictEqual(getRequestOrigin(h({})), "https://prod.example.com");

    // Redirect builder should preserve a safe next path.
    {
      const { redirectTo, next } = buildAuthCallbackRedirectTo({
        origin: "https://x.example.com/",
        nextPath: "/admin/unlock?from=invite",
      });
      assert.strictEqual(next, "/admin/unlock?from=invite");
      assert.strictEqual(
        redirectTo,
        "https://x.example.com/auth/callback?next=%2Fadmin%2Funlock%3Ffrom%3Dinvite",
      );
    }

    // Redirect builder should default unsafe next paths to "/".
    {
      const { redirectTo, next } = buildAuthCallbackRedirectTo({
        origin: "https://x.example.com",
        nextPath: "https://evil.com/phish",
      });
      assert.strictEqual(next, "/");
      assert.strictEqual(redirectTo, "https://x.example.com/auth/callback?next=%2F");
    }

    console.log("requestOrigin tests passed");
  } finally {
    process.env = originalEnv;
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

