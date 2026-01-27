import assert from "node:assert";

(async () => {
  const { toggleSupplierKickoffTask } = await import("../src/server/quotes/kickoffTasks");

  let lastUpdatePayload: Record<string, unknown> | null = null;
  let updateCalls = 0;

  const fakeSupabase = {
    from() {
      return {
        update(payload: Record<string, unknown>) {
          updateCalls += 1;
          lastUpdatePayload = payload;
          const chain = {
            eq() {
              return chain;
            },
            select: async () => ({ data: [{ id: "row-1" }], error: null }),
          };
          return chain;
        },
      };
    },
  };

  const result = await toggleSupplierKickoffTask(
    {
      quoteId: "11111111-1111-4111-8111-111111111111",
      supplierId: "22222222-2222-4222-8222-222222222222",
      taskKey: "confirm-details",
      title: "Confirm details",
      description: null,
      completed: true,
      completedAt: new Date().toISOString(),
      completedByUserId: "33333333-3333-4333-8333-333333333333",
      completedByRole: "supplier",
      sortOrder: 1,
    },
    { supabase: fakeSupabase as any, supplierTasksTable: "quote_kickoff_tasks" },
  );

  assert.deepStrictEqual(result, { ok: true, error: null });
  assert.strictEqual(updateCalls, 1, "Expected update path to succeed without insert");
  assert.ok(lastUpdatePayload, "Expected update payload to be captured");

  // Critical: do not write `completed` when using completed_at mechanism.
  assert.ok("completed_at" in (lastUpdatePayload as any), "Expected completed_at to be written");
  assert.ok(!("completed" in (lastUpdatePayload as any)), "Expected completed to NOT be written");

  console.log("toggleSupplierKickoffTaskCompletion tests passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

