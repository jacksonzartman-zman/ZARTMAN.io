import assert from "node:assert";

(async () => {
  const { buildSearchStateSummary } = await import("../src/lib/search/searchState");

  const destinations = [
    {
      id: "dest-1",
      rfq_id: "rfq-1",
      provider_id: "provider-1",
      status: "sent",
      last_status_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      provider: null,
    },
  ] as any[];

  const offers = [
    {
      id: "offer-1",
      rfq_id: "rfq-1",
      provider_id: "provider-1",
      destination_id: null,
      currency: "USD",
      total_price: 1234,
      unit_price: null,
      tooling_price: null,
      shipping_price: null,
      lead_time_days_min: 7,
      lead_time_days_max: 10,
      assumptions: null,
      notes: null,
      confidence_score: null,
      quality_risk_flags: [],
      status: "withdrawn",
      received_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      provider: null,
    },
    {
      id: "offer-2",
      rfq_id: "rfq-1",
      provider_id: "provider-2",
      destination_id: null,
      currency: "USD",
      total_price: 1500,
      unit_price: null,
      tooling_price: null,
      shipping_price: null,
      lead_time_days_min: 9,
      lead_time_days_max: 12,
      assumptions: null,
      notes: null,
      confidence_score: null,
      quality_risk_flags: [],
      status: "quoted",
      received_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      provider: null,
    },
  ] as any[];

  const summary = buildSearchStateSummary({ destinations, offers });
  assert.strictEqual(
    summary.counts.offers_total,
    1,
    "Expected withdrawn offers to be excluded and quoted offers to count",
  );
  assert.strictEqual(
    summary.status_label,
    "results_available",
    "Expected results_available when a returned offer exists",
  );

  console.log("searchStateOfferCounts tests passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

