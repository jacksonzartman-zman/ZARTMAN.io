import assert from "node:assert";

(async () => {
  const { isNavHrefActive, normalizePathname, pickBestActiveHref } = await import(
    "../src/lib/navigation/portalNav"
  );

  // Normalization
  assert.strictEqual(normalizePathname(""), "/");
  assert.strictEqual(normalizePathname("supplier/quotes"), "/supplier/quotes");
  assert.strictEqual(normalizePathname("/supplier/quotes?x=1#y"), "/supplier/quotes");

  // Segment-boundary matching
  assert.strictEqual(isNavHrefActive("/supplier/quotes/123", "/supplier/quotes"), true);
  assert.strictEqual(isNavHrefActive("/supplier-foo", "/supplier"), false);

  // Best-match selection (deep links should pick the most specific tab)
  assert.strictEqual(
    pickBestActiveHref("/supplier/quotes/123", ["/supplier", "/supplier/quotes"]),
    "/supplier/quotes",
  );

  // Overlapping admin links should not yield multiple "active" candidates
  assert.strictEqual(
    pickBestActiveHref("/admin/bench-health/tasks", [
      "/admin/bench-health",
      "/admin/bench-health/tasks",
    ]),
    "/admin/bench-health/tasks",
  );

  // Unknown pages should yield no active href
  assert.strictEqual(pickBestActiveHref("/not-in-nav", ["/customer/quotes", "/supplier"]), null);

  console.log("portalNavActiveHref tests passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

