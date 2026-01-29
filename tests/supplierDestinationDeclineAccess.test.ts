import assert from "node:assert";

type Row = Record<string, any>;

class FakeSupabaseQuery {
  private table: string;
  private rowsByTable: Record<string, Row[]>;
  private filters: Array<{ op: "eq"; key: string; value: any }> = [];
  private mode: "select" | "update" = "select";
  private updatePayload: Record<string, any> | null = null;
  private _singleMode: "maybeSingle" | null = null;

  constructor(table: string, rowsByTable: Record<string, Row[]>) {
    this.table = table;
    this.rowsByTable = rowsByTable;
  }

  select(_columns: string) {
    this.mode = "select";
    return this;
  }

  update(payload: Record<string, any>) {
    this.mode = "update";
    this.updatePayload = payload;
    return this;
  }

  eq(key: string, value: any) {
    this.filters.push({ op: "eq", key, value });
    return this;
  }

  maybeSingle<T>() {
    this._singleMode = "maybeSingle";
    return this as any as Promise<{ data: T | null; error: any }>;
  }

  private applyFilters(rows: Row[]) {
    return rows.filter((row) => {
      for (const f of this.filters) {
        if (f.op === "eq" && row[f.key] !== f.value) return false;
      }
      return true;
    });
  }

  private async execute() {
    const rows = Array.isArray(this.rowsByTable[this.table])
      ? this.rowsByTable[this.table]
      : [];
    const filtered = this.applyFilters(rows);

    if (this.mode === "update") {
      for (const row of filtered) {
        Object.assign(row, this.updatePayload ?? {});
      }
      return { data: null, error: null };
    }

    if (this._singleMode === "maybeSingle") {
      return { data: (filtered[0] ?? null) as any, error: null };
    }

    return { data: filtered, error: null };
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled as any, onrejected as any);
  }
}

class FakeSupabase {
  rowsByTable: Record<string, Row[]>;

  constructor(rowsByTable: Record<string, Row[]>) {
    this.rowsByTable = rowsByTable;
  }

  from(table: string) {
    return new FakeSupabaseQuery(table, this.rowsByTable);
  }
}

(async () => {
  const { declineRfqDestinationAsSupplier } = await import(
    "../src/server/rfqs/declineDestination"
  );

  // Case 1: invalid input
  {
    const client = new FakeSupabase({ rfq_destinations: [] }) as any;
    const result = await declineRfqDestinationAsSupplier(
      { rfqId: "", providerId: "", actorUserId: "user-1" },
      { client },
    );
    assert.deepStrictEqual(result, { ok: false, error: "invalid_input" });
  }

  // Case 2: access denied when supplier isn't assigned via rfq_destinations
  {
    const client = new FakeSupabase({
      rfq_destinations: [{ id: "dest-1", rfq_id: "rfq-1", provider_id: "provider-other", status: "sent" }],
    }) as any;

    const events: any[] = [];
    const result = await declineRfqDestinationAsSupplier(
      { rfqId: "rfq-1", providerId: "provider-1", actorUserId: "user-1" },
      {
        client,
        emitEvent: async (event) => {
          events.push(event);
          return { ok: true };
        },
      },
    );

    assert.deepStrictEqual(result, { ok: false, error: "forbidden" });
    assert.deepStrictEqual(events, []);
  }

  // Case 3: assigned supplier can decline; destination status updates and event is emitted
  {
    const destinations = [{ id: "dest-1", rfq_id: "rfq-1", provider_id: "provider-1", status: "sent" }];
    const client = new FakeSupabase({ rfq_destinations: destinations }) as any;

    const events: any[] = [];
    const result = await declineRfqDestinationAsSupplier(
      { rfqId: "rfq-1", providerId: "provider-1", actorUserId: "user-1" },
      {
        client,
        nowIso: "2026-01-29T00:00:00.000Z",
        emitEvent: async (event, _deps) => {
          events.push(event);
          return { ok: true };
        },
      },
    );

    assert.deepStrictEqual(result, { ok: true });
    assert.strictEqual(destinations[0].status, "declined", "Expected destination status to update");
    assert.deepStrictEqual(events, [
      {
        rfqId: "rfq-1",
        eventType: "destination_declined",
        actorRole: "supplier",
        actorUserId: "user-1",
        createdAt: "2026-01-29T00:00:00.000Z",
      },
    ]);
  }

  console.log("supplierDestinationDeclineAccess tests passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

