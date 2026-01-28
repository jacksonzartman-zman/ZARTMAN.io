import assert from "node:assert";

(async () => {
  const { writeRfqOffer } = await import("../src/server/rfqs/writeRfqOffer");

  function buildClient(args: {
    preRows: Array<{ id: string; status: string; provider_id: string | null }>;
    nextOfferId: string;
    mode: "insert" | "upsert";
  }) {
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
              return {
                select() {
                  return {
                    maybeSingle: async () => ({ data: { id: args.nextOfferId }, error: null }),
                  };
                },
              };
            },
            insert() {
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
      mode: "insert",
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
      mode: "upsert",
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
      mode: "upsert",
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

  console.log("writeRfqOffer tests passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

