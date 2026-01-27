import assert from "node:assert";

(async () => {
  const { seedDemoSearchRequest } = await import(
    "../src/server/demo/seedDemoSearchRequest"
  );

  const expected =
    "[demo seed] SUPABASE_SERVICE_ROLE_KEY missing; demo seed requires admin client";

  const prevServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const result = await seedDemoSearchRequest({
      adminUserId: "11111111-1111-4111-8111-111111111111",
      adminEmail: "admin@example.com",
    });

    assert.deepStrictEqual(result, { ok: false, error: expected });
    console.log("demoSeedMissingServiceRoleKey tests passed");
  } finally {
    if (typeof prevServiceRoleKey === "string") {
      process.env.SUPABASE_SERVICE_ROLE_KEY = prevServiceRoleKey;
    } else {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    }
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

