import assert from "node:assert";

type Row = Record<string, any>;

class FakeSupabaseQuery {
  private table: string;
  private rowsByTable: Record<string, Row[]>;
  private filters: Array<{ op: "eq" | "neq"; key: string; value: any }> = [];
  private _limit = Infinity;
  private _singleMode: "maybeSingle" | null = null;

  constructor(table: string, rowsByTable: Record<string, Row[]>) {
    this.table = table;
    this.rowsByTable = rowsByTable;
  }

  select(_columns: string, _opts?: any) {
    return this;
  }

  eq(key: string, value: any) {
    this.filters.push({ op: "eq", key, value });
    return this;
  }

  neq(key: string, value: any) {
    this.filters.push({ op: "neq", key, value });
    return this;
  }

  limit(n: number) {
    this._limit = n;
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
        if (f.op === "neq" && row[f.key] === f.value) return false;
      }
      return true;
    });
  }

  private async execute() {
    const rows = Array.isArray(this.rowsByTable[this.table])
      ? this.rowsByTable[this.table]
      : [];
    const filtered = this.applyFilters(rows).slice(0, this._limit);

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
  private rowsByTable: Record<string, Row[]>;

  constructor(rowsByTable: Record<string, Row[]>) {
    this.rowsByTable = rowsByTable;
  }

  from(table: string) {
    return new FakeSupabaseQuery(table, this.rowsByTable);
  }
}

(async () => {
  const originalEnv = { ...process.env };
  const originalConsoleDebug = console.debug;

  try {
    // Silence demo debugOnce output in this test.
    console.debug = () => {};

    process.env.DEMO_MODE = "true";
    process.env.NODE_ENV = "development";
    process.env.VERCEL_ENV = "preview";

    const { assertSupplierQuoteAccess } = await import("../src/server/quotes/access");

    const quoteId = "rfq_1";
    const supplierId = "supplier_1";
    const providerId = "provider_demo_1";

    // 1) demo provider with only an rfq_offer passes access
    {
      const supabase = new FakeSupabase({
        supplier_bids: [],
        quote_invites: [],
        quotes: [{ id: quoteId, awarded_supplier_id: null, assigned_supplier_email: null }],
        rfq_destinations: [],
        rfq_offers: [{ id: "offer_1", rfq_id: quoteId, provider_id: providerId, status: "submitted" }],
      }) as any;

      const result = await assertSupplierQuoteAccess({
        quoteId,
        supplierId,
        supabase,
        demoProviderId: providerId,
      });
      assert.strictEqual(result.ok, true, "Expected demo offer association to allow access");
    }

    // 2) demo provider with only an rfq_destination passes access
    {
      const supabase = new FakeSupabase({
        supplier_bids: [],
        quote_invites: [],
        quotes: [{ id: quoteId, awarded_supplier_id: null, assigned_supplier_email: null }],
        rfq_destinations: [{ id: "dest_1", rfq_id: quoteId, provider_id: providerId }],
        rfq_offers: [],
      }) as any;

      const result = await assertSupplierQuoteAccess({
        quoteId,
        supplierId,
        supabase,
        demoProviderId: providerId,
      });
      assert.strictEqual(
        result.ok,
        true,
        "Expected demo destination association to allow access",
      );
    }

    // 3) demo provider with neither fails access
    {
      const supabase = new FakeSupabase({
        supplier_bids: [],
        quote_invites: [],
        quotes: [{ id: quoteId, awarded_supplier_id: null, assigned_supplier_email: null }],
        rfq_destinations: [],
        rfq_offers: [],
      }) as any;

      const result = await assertSupplierQuoteAccess({
        quoteId,
        supplierId,
        supabase,
        demoProviderId: providerId,
      });
      assert.strictEqual(result.ok, false, "Expected demo provider with no association to deny");
      assert.strictEqual(
        result.reason,
        "no_access",
        "Expected demo provider with no association to yield no_access",
      );
    }

    console.log("demoSupplierAccessGating tests passed");
  } finally {
    process.env = originalEnv;
    console.debug = originalConsoleDebug;
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

