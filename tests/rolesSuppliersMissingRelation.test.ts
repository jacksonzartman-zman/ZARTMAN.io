import assert from "node:assert";

(async () => {
  const { resolveUserRoles } = await import("../src/server/users/roles");

  let supplierLookupCalled = false;
  const infoLines: unknown[][] = [];
  const originalInfo = console.info;
  console.info = (...args: unknown[]) => {
    infoLines.push(args);
    return originalInfo(...args);
  };

  try {
    const deps = {
      isDemoModeEnabled: () => true,
      getCustomerByUserId: async () =>
        ({
          id: "22222222-2222-4222-8222-222222222222",
          user_id: "11111111-1111-4111-8111-111111111111",
          email: "customer@example.com",
          company_name: "Demo Corp",
          created_at: new Date().toISOString(),
        }) as any,
      loadSupplierByUserId: async () => {
        supplierLookupCalled = true;
        return null;
      },
      requireSchema: async () =>
        ({
          ok: false,
          relation: "suppliers",
          reason: "missing_relation",
        }) as any,
    };

    const result = await resolveUserRoles("11111111-1111-4111-8111-111111111111", undefined, deps);

    assert.strictEqual(supplierLookupCalled, false, "Expected supplier lookup to be skipped");
    assert.strictEqual(result.isSupplier, false);
    assert.strictEqual(result.isCustomer, true);
    assert.strictEqual(result.primaryRole, "customer");

    // Even if a supplier record is "preloaded", schema gating must keep isSupplier false.
    const resultWithPreloadedSupplier = await resolveUserRoles(
      "11111111-1111-4111-8111-111111111111",
      { supplier: ({ id: "33333333-3333-4333-8333-333333333333", user_id: "11111111-1111-4111-8111-111111111111" } as any) },
      deps,
    );
    assert.strictEqual(resultWithPreloadedSupplier.isSupplier, false);
    assert.strictEqual(resultWithPreloadedSupplier.isCustomer, true);
    assert.strictEqual(resultWithPreloadedSupplier.primaryRole, "customer");

    // Single info line (once per process) for this skip path.
    const matching = infoLines.filter((args) => args[0] === "[roles] supplier role skipped due to missing suppliers relation");
    assert.strictEqual(matching.length, 1, "Expected exactly one info log line for supplier skip");

    console.log("rolesSuppliersMissingRelation tests passed");
  } finally {
    console.info = originalInfo;
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

