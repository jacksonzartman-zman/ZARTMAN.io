import assert from "node:assert";

(async () => {
  const { computeThreadNeedsReplyFromLastMessage } = await import(
    "../src/server/messages/threadNeedsReply"
  );

  const now = "2026-01-28T12:00:00.000Z";

  // last msg customer => admin needs reply (+ SLA buckets)
  {
    const oneHourAgo = "2026-01-28T11:00:00.000Z";
    const r = computeThreadNeedsReplyFromLastMessage({
      lastMessageAt: oneHourAgo,
      lastMessageAuthorRole: "customer",
      now,
    });
    assert.strictEqual(r.needs_reply_role, "admin");
    assert.strictEqual(r.sla_bucket, "<2h");
  }
  {
    const threeHoursAgo = "2026-01-28T09:00:00.000Z";
    const r = computeThreadNeedsReplyFromLastMessage({
      lastMessageAt: threeHoursAgo,
      lastMessageAuthorRole: "customer",
      now,
    });
    assert.strictEqual(r.needs_reply_role, "admin");
    assert.strictEqual(r.sla_bucket, "<24h");
  }
  {
    const twentyFiveHoursAgo = "2026-01-27T11:00:00.000Z";
    const r = computeThreadNeedsReplyFromLastMessage({
      lastMessageAt: twentyFiveHoursAgo,
      lastMessageAuthorRole: "customer",
      now,
    });
    assert.strictEqual(r.needs_reply_role, "admin");
    assert.strictEqual(r.sla_bucket, ">24h");
  }

  // last msg admin => customer needs reply
  {
    const r = computeThreadNeedsReplyFromLastMessage({
      lastMessageAt: "2026-01-28T11:59:00.000Z",
      lastMessageAuthorRole: "admin",
      now,
    });
    assert.strictEqual(r.needs_reply_role, "customer");
    assert.strictEqual(r.sla_bucket, "none");
  }

  // last msg supplier => admin needs reply
  {
    const r = computeThreadNeedsReplyFromLastMessage({
      lastMessageAt: "2026-01-28T11:30:00.000Z",
      lastMessageAuthorRole: "supplier",
      now,
    });
    assert.strictEqual(r.needs_reply_role, "admin");
    assert.strictEqual(r.sla_bucket, "<2h");
  }

  console.log("threadNeedsReply18_3 tests passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

