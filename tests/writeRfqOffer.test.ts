import assert from "node:assert";

(async () => {
  const { writeRfqOffer } = await import("../src/server/rfqs/writeRfqOffer");

  function buildClient(args: {
    preRows: Array<{ id: string; status: string; provider_id: string | null }>;
    nextOfferId: string;
    quoteCustomerId?: string | null;
    exclusions?: Array<{
      id: string;
      customer_id: string;
      excluded_provider_id: string | null;
      excluded_source_name: string | null;
      reason: string | null;
      created_at: string;
    }>;
    failOnWrite?: boolean;
  }) {
    const quoteCustomerId = args.quoteCustomerId ?? null;
    const exclusions = args.exclusions ?? [];
    return {
      from(table: string) {
        if (table === "rfq_offers") {
          return {
            select() {
              return {
                eq() {
                  return {
                    returns: async () => ({ data: args.preRows, error: null }),
                  };
                },
              };
            },
            upsert() {
              if (args.failOnWrite) {
                throw new Error("Unexpected rfq_offers upsert (should have been blocked)");
              }
              return {
                select() {
                  return {
                    maybeSingle: async () => ({ data: { id: args.nextOfferId }, error: null }),
                  };
                },
              };
            },
            insert() {
              if (args.failOnWrite) {
                throw new Error("Unexpected rfq_offers insert (should have been blocked)");
              }
              return {
                select() {
                  return {
                    maybeSingle: async () => ({ data: { id: args.nextOfferId }, error: null }),
                  };
                },
              };
            },
          };
        }

        if (table === "quotes") {
          return {
            select() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({
                      data: { customer_id: quoteCustomerId },
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        }

        if (table === "customer_exclusions") {
          return {
            select() {
              return {
                eq() {
                  return {
                    order() {
                      return {
                        returns: async () => ({ data: exclusions, error: null }),
                      };
                    },
                  };
                },
              };
            },
          };
        }

        if (table === "rfq_destinations") {
          return {
            update() {
              return {
                eq() {
                  return {
                    eq() {
                      return { then: undefined, catch: undefined };
                    },
                  };
                },
              };
            },
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    };
  }

  // Case 1: external/broker offer is first offer => triggers notification.
  {
    const calls: any[] = [];
    const client = buildClient({
      preRows: [],
      nextOfferId: "offer-external-1",
      quoteCustomerId: null,
    });

    const result = await writeRfqOffer({
      rfqId: "rfq-1",
      providerId: null,
      destinationId: null,
      currency: "USD",
      totalPrice: 1000,
      leadTimeDaysMin: 10,
      leadTimeDaysMax: 10,
      status: "quoted",
      actorSource: "admin_external_offer",
      deps: {
        client: client as any,
        logOps: async () => {},
        notifyFirstOffer: async (payload) => {
          calls.push(payload);
        },
      },
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual((result as any).offerId, "offer-external-1");
    assert.strictEqual((result as any).wasRevision, false);
    assert.strictEqual((result as any).triggeredFirstOfferNotification, true);
    assert.deepStrictEqual(calls, [{ quoteId: "rfq-1", offerId: "offer-external-1" }]);
  }

  // Case 2: supplier offer arrives when only withdrawn offers exist => triggers notification.
  {
    const calls: any[] = [];
    const client = buildClient({
      preRows: [{ id: "old-1", status: "withdrawn", provider_id: "provider-old" }],
      nextOfferId: "offer-supplier-1",
      quoteCustomerId: null,
    });

    const result = await writeRfqOffer({
      rfqId: "rfq-2",
      providerId: "provider-a",
      destinationId: "dest-a",
      currency: "USD",
      totalPrice: 2000,
      leadTimeDaysMin: 7,
      leadTimeDaysMax: 7,
      status: "received",
      actorSource: "provider_token",
      deps: {
        client: client as any,
        logOps: async () => {},
        notifyFirstOffer: async (payload) => {
          calls.push(payload);
        },
      },
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual((result as any).offerId, "offer-supplier-1");
    assert.strictEqual((result as any).wasRevision, false);
    assert.strictEqual((result as any).triggeredFirstOfferNotification, true);
    assert.deepStrictEqual(calls, [{ quoteId: "rfq-2", offerId: "offer-supplier-1" }]);
  }

  // Case 3: provider resubmits (revision) => no first-offer notification, wasRevision true.
  {
    const calls: any[] = [];
    const client = buildClient({
      preRows: [{ id: "existing", status: "received", provider_id: "provider-x" }],
      nextOfferId: "existing",
      quoteCustomerId: null,
    });

    const result = await writeRfqOffer({
      rfqId: "rfq-3",
      providerId: "provider-x",
      destinationId: "dest-x",
      currency: "USD",
      totalPrice: 3000,
      leadTimeDaysMin: 12,
      leadTimeDaysMax: 12,
      status: "received",
      actorSource: "provider_token",
      deps: {
        client: client as any,
        logOps: async () => {},
        notifyFirstOffer: async (payload) => {
          calls.push(payload);
        },
      },
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual((result as any).offerId, "existing");
    assert.strictEqual((result as any).wasRevision, true);
    assert.strictEqual((result as any).triggeredFirstOfferNotification, false);
    assert.deepStrictEqual(calls, []);
  }

  // Case 4: excluded provider offer is blocked (clear error).
  {
    const nowIso = new Date().toISOString();
    const client = buildClient({
      preRows: [],
      nextOfferId: "should-not-write",
      quoteCustomerId: "cust-1",
      exclusions: [
        {
          id: "ex-1",
          customer_id: "cust-1",
          excluded_provider_id: "provider-blocked",
          excluded_source_name: null,
          reason: "policy",
          created_at: nowIso,
        },
      ],
      failOnWrite: true,
    });

    const result = await writeRfqOffer({
      rfqId: "rfq-4",
      providerId: "provider-blocked",
      destinationId: "dest-x",
      currency: "USD",
      totalPrice: 3000,
      leadTimeDaysMin: 12,
      leadTimeDaysMax: 12,
      status: "received",
      actorSource: "provider_token",
      deps: { client: client as any, logOps: async () => {}, notifyFirstOffer: async () => {} },
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual((result as any).reason, "customer_exclusion");
    assert.ok(
      typeof (result as any).error === "string" &&
        (result as any).error.toLowerCase().includes("excludes"),
      "Expected an exclusion error message",
    );
  }

  // Case 5: excluded source_name offer is blocked (case-insensitive).
  {
    const nowIso = new Date().toISOString();
    const client = buildClient({
      preRows: [],
      nextOfferId: "should-not-write",
      quoteCustomerId: "cust-2",
      exclusions: [
        {
          id: "ex-2",
          customer_id: "cust-2",
          excluded_provider_id: null,
          excluded_source_name: "xometry",
          reason: null,
          created_at: nowIso,
        },
      ],
      failOnWrite: true,
    });

    const result = await writeRfqOffer({
      rfqId: "rfq-5",
      providerId: null,
      destinationId: null,
      currency: "USD",
      totalPrice: 3000,
      leadTimeDaysMin: 12,
      leadTimeDaysMax: 12,
      status: "quoted",
      sourceType: "marketplace",
      sourceName: "Xometry",
      actorSource: "admin_external_offer",
      deps: { client: client as any, logOps: async () => {}, notifyFirstOffer: async () => {} },
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual((result as any).reason, "customer_exclusion");
    assert.ok(
      typeof (result as any).error === "string" &&
        (result as any).error.toLowerCase().includes("xometry"),
      "Expected source exclusion to mention source name",
    );
  }

  console.log("writeRfqOffer tests passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

