import assert from "node:assert";

(async () => {
  const { __test__buildProviderListWithContactSelect } = await import("../src/server/providers");
  const { __test__buildSupplierSelect } = await import("../src/server/suppliers/profile");

  // Providers: when schema probes say "no email columns", we must not include any email field in selects.
  {
    const hasColumns = async (_relation: string, _cols: string[]) => false;
    const { selectColumns, emailColumn } = await __test__buildProviderListWithContactSelect({
      hasColumns,
    });

    assert.strictEqual(emailColumn, null);
    const select = selectColumns.join(",");
    assert.ok(!select.includes("primary_email"));
    assert.ok(!select.includes("contact_email"));
    // "email" must not appear as a standalone selected column either.
    assert.ok(!select.split(",").includes("email"));
  }

  // Suppliers: when schema probes say "no provider_id", supplier profile queries must not request it.
  {
    const hasColumns = async (_relation: string, _cols: string[]) => false;
    const select = await __test__buildSupplierSelect({ hasColumns });
    assert.ok(!select.split(",").includes("provider_id"));
  }

  console.log("schemaSafeOptionalColumns tests passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

