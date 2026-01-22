import assert from "node:assert";
import {
  buildCustomerProjectTimeline,
  computeCustomerProjectTimelineStage,
} from "../src/lib/quote/customerProjectTimeline";

assert.strictEqual(
  computeCustomerProjectTimelineStage({
    offersCount: 0,
    introRequested: false,
    supplierAwarded: false,
    kickoffStarted: false,
    inProduction: false,
  }),
  "search_started",
);

assert.strictEqual(
  computeCustomerProjectTimelineStage({
    offersCount: 1,
    introRequested: false,
    supplierAwarded: false,
    kickoffStarted: false,
    inProduction: false,
  }),
  "offers_received",
);

assert.strictEqual(
  computeCustomerProjectTimelineStage({
    offersCount: 0,
    introRequested: true,
    supplierAwarded: false,
    kickoffStarted: false,
    inProduction: false,
  }),
  "intro_requested",
);

assert.strictEqual(
  computeCustomerProjectTimelineStage({
    offersCount: 0,
    introRequested: false,
    supplierAwarded: true,
    kickoffStarted: false,
    inProduction: false,
  }),
  "supplier_awarded",
);

assert.strictEqual(
  computeCustomerProjectTimelineStage({
    offersCount: 0,
    introRequested: false,
    supplierAwarded: false,
    kickoffStarted: true,
    inProduction: false,
  }),
  "kickoff_started",
);

assert.strictEqual(
  computeCustomerProjectTimelineStage({
    offersCount: 0,
    introRequested: false,
    supplierAwarded: false,
    kickoffStarted: false,
    inProduction: true,
  }),
  "in_production",
);

const timeline = buildCustomerProjectTimeline({
  offersCount: 0,
  introRequested: false,
  supplierAwarded: false,
  kickoffStarted: false,
  inProduction: false,
});

assert.strictEqual(timeline.stage, "search_started");
assert.strictEqual(timeline.steps[0]?.status, "current");
assert.strictEqual(timeline.steps[timeline.steps.length - 1]?.status, "upcoming");

console.log("customerProjectTimeline tests passed");

