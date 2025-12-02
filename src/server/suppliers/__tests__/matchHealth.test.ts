import test from "node:test";
import assert from "node:assert/strict";

import { selectRecentMatchHealthExamples } from "../matchHealth";

test("selectRecentMatchHealthExamples sorts by recency and limits results", () => {
  const events = [
    {
      quoteId: "older",
      status: "open",
      processHint: "cnc machining",
      createdAt: "2024-01-01T12:00:00.000Z",
      outcome: "matched" as const,
    },
    {
      quoteId: "newer",
      status: "open",
      processHint: "3d printing",
      createdAt: "2024-02-01T12:00:00.000Z",
      outcome: "skipped_capability" as const,
    },
    {
      quoteId: "newest",
      status: "open",
      processHint: "sheet metal",
      createdAt: "2024-03-01T12:00:00.000Z",
      outcome: "matched" as const,
    },
  ];

  const result = selectRecentMatchHealthExamples(events, 2);

  assert.equal(result.length, 2);
  assert.equal(result[0].quoteId, "newest");
  assert.equal(result[1].quoteId, "newer");
});

test("selectRecentMatchHealthExamples handles empty input", () => {
  const result = selectRecentMatchHealthExamples([], 3);
  assert.deepEqual(result, []);
});
