import assert from "node:assert";

(async () => {
  const { DEFAULT_SUPPLIER_KICKOFF_TASKS } = await import("../src/lib/quote/kickoffChecklist");
  const { ensureKickoffTasksForOfferAward } = await import("../src/server/quotes/kickoffTasks");

  const quoteId = "11111111-1111-4111-8111-111111111111";
  const providerId = "provider-1";

  const calls: Array<{ table: string; rows: any[]; onConflict?: string; ignoreDuplicates?: boolean }> = [];

  const fakeSupabase = {
    from(table: string) {
      return {
        upsert(rows: any[], opts: { onConflict?: string; ignoreDuplicates?: boolean }) {
          calls.push({ table, rows, onConflict: opts?.onConflict, ignoreDuplicates: opts?.ignoreDuplicates });
          return {
            select() {
              return {
                returns: async () => ({
                  data: rows.map((_: any, idx: number) => ({ id: String(idx) })),
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  };

  const schemaGate = async (opts: any) => {
    // Allow quote-level kickoff schema; deny everything else.
    if (opts?.relation === "quote_kickoff_tasks") return true;
    return false;
  };

  const result = await ensureKickoffTasksForOfferAward(
    { quoteId, providerId },
    {
      supabase: fakeSupabase as any,
      schemaGate: schemaGate as any,
      hasColumns: async () => false,
    },
  );

  assert.deepStrictEqual(result, { ok: true, seeded: true, error: null });
  assert.strictEqual(calls.length, 1, "Expected a single upsert call");

  const [call] = calls;
  assert.strictEqual(call.table, "quote_kickoff_tasks");
  assert.strictEqual(call.onConflict, "quote_id,task_key");
  assert.strictEqual(call.ignoreDuplicates, true);
  assert.strictEqual(call.rows.length, DEFAULT_SUPPLIER_KICKOFF_TASKS.length);

  for (const row of call.rows) {
    assert.strictEqual(row.quote_id, quoteId);
    assert.strictEqual(row.status, "pending");
    assert.ok(typeof row.task_key === "string" && row.task_key.length > 0);
    assert.ok(typeof row.title === "string" && row.title.length > 0);
    // Quote-level kickoff tasks should not be supplier-scoped.
    assert.ok(!("supplier_id" in row));
  }

  console.log("kickoffOfferAwardEnsure tests passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

