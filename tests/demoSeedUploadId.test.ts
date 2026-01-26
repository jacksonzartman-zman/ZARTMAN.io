import assert from "node:assert";

(async () => {
  const { buildDemoQuoteInsertPayload, buildDemoUploadInsertPayload } = await import(
    "../src/server/demo/seedDemoSearchRequest"
  );

  const nowIso = new Date().toISOString();
  const customerId = "11111111-1111-4111-8111-111111111111";
  const customerEmail = "demo@example.com";
  const uploadId = "22222222-2222-4222-8222-222222222222";

  const uploadPayload = buildDemoUploadInsertPayload({
    customerId,
    customerEmail,
    nowIso,
  });

  assert.ok(uploadPayload.file_name, "Expected upload payload to include file_name");
  assert.ok(uploadPayload.file_path, "Expected upload payload to include file_path");
  assert.ok(uploadPayload.customer_id, "Expected upload payload to include customer_id");

  const quotePayload = buildDemoQuoteInsertPayload({
    customerId,
    customerEmail,
    uploadId,
    nowIso,
  });

  assert.strictEqual(
    (quotePayload as any).upload_id,
    uploadId,
    "Expected demo seed quote payload to include non-null upload_id",
  );

  console.log("demoSeedUploadId tests passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

