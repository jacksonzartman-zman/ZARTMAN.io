import assert from "node:assert";

(async () => {
  const { getRfqOffers } = await import("../src/server/rfqs/offers");
  const { buildCustomerCompareOffers } = await import("../src/server/customer/compareOffers");

  const rfqId = "11111111-1111-4111-8111-111111111111";
  const nowIso = new Date().toISOString();

  const rows = [
    {
      id: "offer-1",
      rfq_id: rfqId,
      provider_id: "provider-1",
      destination_id: null,
      currency: "USD",
      total_price: 1000,
      unit_price: null,
      tooling_price: null,
      shipping_price: null,
      lead_time_days_min: 7,
      lead_time_days_max: 10,
      assumptions: null,
      notes: null,
      confidence_score: 90,
      quality_risk_flags: [],
      status: "received",
      received_at: nowIso,
      created_at: nowIso,
      provider: null,
    },
    {
      id: "offer-2",
      rfq_id: rfqId,
      provider_id: "provider-2",
      destination_id: null,
      currency: "USD",
      total_price: 1200,
      unit_price: null,
      tooling_price: null,
      shipping_price: null,
      lead_time_days_min: 12,
      lead_time_days_max: 16,
      assumptions: null,
      notes: null,
      confidence_score: 80,
      quality_risk_flags: [],
      status: "received",
      received_at: nowIso,
      created_at: nowIso,
      provider: null,
    },
    {
      id: "offer-3",
      rfq_id: rfqId,
      provider_id: "provider-3",
      destination_id: null,
      currency: "USD",
      total_price: 1500,
      unit_price: null,
      tooling_price: null,
      shipping_price: null,
      lead_time_days_min: 5,
      lead_time_days_max: 7,
      assumptions: null,
      notes: null,
      confidence_score: 88,
      quality_risk_flags: [],
      status: "received",
      received_at: nowIso,
      created_at: nowIso,
      provider: null,
    },
    {
      id: "offer-4",
      rfq_id: rfqId,
      provider_id: null,
      destination_id: null,
      currency: "USD",
      total_price: 900,
      unit_price: null,
      tooling_price: null,
      shipping_price: null,
      lead_time_days_min: 9,
      lead_time_days_max: 9,
      assumptions: null,
      notes: "Brokered via marketplace",
      source_type: "marketplace",
      source_name: "Xometry",
      confidence_score: null,
      quality_risk_flags: [],
      status: "quoted",
      received_at: nowIso,
      created_at: nowIso,
      provider: null,
    },
  ];

  const fakeClient = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                order() {
                  return {
                    returns: async () => ({ data: rows, error: null }),
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  const offers = await getRfqOffers(rfqId, { client: fakeClient as any });
  assert.strictEqual(offers.length, 4, "Expected loader to return 4 rfq_offers rows");
  assert.ok(
    offers.every((o) => o.rfq_id === rfqId),
    "Expected offers to match requested rfq_id",
  );
  assert.ok(offers.some((o) => o.status === "quoted"), "Expected external offer status to be quoted");

  const compareOffers = await buildCustomerCompareOffers(offers);
  assert.strictEqual(compareOffers.length, 4, "Expected UI compare offers to render 4 offer cards");
  const broker = compareOffers.find((o) => o.id === "offer-4");
  assert.ok(broker, "Expected broker offer to be present in compare offers");
  assert.strictEqual(broker?.providerName, "Xometry", "Expected broker offer provider name to use source_name");
  assert.strictEqual(
    broker?.provider_id,
    "external:offer-4",
    "Expected broker offer provider_id to be a stable synthetic key",
  );

  console.log("customerOffersLoader tests passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

