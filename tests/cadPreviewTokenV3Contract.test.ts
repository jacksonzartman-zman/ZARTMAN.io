import assert from "node:assert";
import { signPreviewToken, verifyPreviewTokenForUser } from "../src/server/cadPreviewToken";

function base64UrlDecodeToString(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

process.env.CAD_PREVIEW_TOKEN_SECRET = process.env.CAD_PREVIEW_TOKEN_SECRET || "test-secret";

const now = Math.floor(Date.now() / 1000);
const exp = now + 60;
const viewerUserId = "00000000-0000-0000-0000-000000000000";
const quoteFileId = "11111111-1111-1111-1111-111111111111";

const token = signPreviewToken({
  exp,
  quoteFileId,
  viewerContext: { userId: viewerUserId },
});

const [payloadB64] = token.split(".");
assert(payloadB64, "Expected token payload segment");

const rawPayload = JSON.parse(base64UrlDecodeToString(payloadB64!)) as any;
assert.strictEqual(rawPayload.v, 3, "Expected v3 token");

const topKeys = Object.keys(rawPayload).sort();
assert.deepStrictEqual(
  topKeys,
  ["exp", "quoteFileId", "v", "viewerContext"].sort(),
  "v3 token must only include { v, quoteFileId, exp, viewerContext }",
);
assert.strictEqual(rawPayload.quoteFileId, quoteFileId, "quoteFileId mismatch");
assert(rawPayload.viewerContext && typeof rawPayload.viewerContext === "object", "viewerContext missing");
assert.strictEqual(rawPayload.viewerContext.userId, viewerUserId, "viewerContext.userId mismatch");
assert.strictEqual(rawPayload.b, undefined, "v3 token must not include bucket");
assert.strictEqual(rawPayload.p, undefined, "v3 token must not include path");
assert.strictEqual(rawPayload.uid, undefined, "v3 token must not include uid");
assert.strictEqual(rawPayload.qfid, undefined, "v3 token must not include qfid");

const verified = verifyPreviewTokenForUser({ token, userId: viewerUserId, nowSeconds: now });
assert(verified.ok, "Expected v3 token to verify for viewer user");

const rejected = verifyPreviewTokenForUser({ token, userId: "22222222-2222-2222-2222-222222222222", nowSeconds: now });
assert(!rejected.ok, "Expected v3 token to reject for wrong user");

console.log("cadPreviewToken v3 contract tests passed");

