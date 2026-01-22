import test from "node:test";
import assert from "node:assert/strict";

import { assessProviderCapabilityMatch } from "@/lib/provider/capabilityMatch";

test("assessProviderCapabilityMatch returns unknown when capability columns missing", () => {
  const result = assessProviderCapabilityMatch({});
  assert.equal(result.health, "unknown");
  assert.equal(result.score, null);
  assert.deepEqual(result.mismatchReasons, []);
});

test("assessProviderCapabilityMatch treats missing processes as mismatch when column present", () => {
  const result = assessProviderCapabilityMatch({ processes: [] });
  assert.equal(result.health, "mismatch");
  assert.equal(result.score, 0);
  assert.equal(result.mismatchReasons.length, 1);
});

test("assessProviderCapabilityMatch yields match when processes/materials/geo are present", () => {
  const result = assessProviderCapabilityMatch({
    processes: ["CNC machining", " sheet metal "],
    materials: ["Aluminum", "Steel"],
    country: "United States",
    states: ["ca", "NY"],
  });
  assert.equal(result.health, "match");
  assert.equal(result.score, 100);
  assert.equal(result.mismatchReasons.length, 0);
  assert.equal(result.partialMatches.length, 0);
  assert.ok(result.matches.length >= 2);
});

test("assessProviderCapabilityMatch yields partial when non-critical capability is missing", () => {
  const result = assessProviderCapabilityMatch({
    processes: ["CNC"],
    materials: [],
    country: null,
    states: [],
  });
  assert.equal(result.health, "partial");
  assert.equal(result.mismatchReasons.length, 0);
  assert.ok(result.partialMatches.length >= 1);
  assert.equal(result.score, 60);
});

