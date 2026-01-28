import assert from "node:assert";

(async () => {
  const { resolveUserRoles } = await import("../src/server/users/roles");

  let supplierLookupCalled = false;

  const result = await resolveUserRoles(
    "11111111-1111-4111-8111-111111111111",
    undefined,
    {
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
    },
  );

  assert.strictEqual(supplierLookupCalled, false, "Expected supplier lookup to be skipped");
  assert.strictEqual(result.isSupplier, false);
  assert.strictEqual(result.isCustomer, true);
  assert.strictEqual(result.primaryRole, "customer");
  console.log("rolesSuppliersMissingRelation tests passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

