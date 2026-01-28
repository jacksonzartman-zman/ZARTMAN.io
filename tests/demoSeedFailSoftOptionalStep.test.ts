import assert from "node:assert";

(async () => {
  const { seedDemoSearchRequest } = await import(
    "../src/server/demo/seedDemoSearchRequest"
  );

  const quoteId = "33333333-3333-4333-8333-333333333333";
  const uploadId = "22222222-2222-4222-8222-222222222222";

  const result = await seedDemoSearchRequest(
    {
      adminUserId: "11111111-1111-4111-8111-111111111111",
      adminEmail: "admin@example.com",
    },
    {
      adminClient: {} as any,
      ensureSchema: async () => ({ ok: true }),
      ensureCustomer: async () => ({
        ok: true,
        customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        email: "demo@example.com",
      }),
      ensureProviders: async () => ({
        ok: true,
        providers: [
          { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Demo CNC Works" },
          { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Demo Sheet Metal Co" },
        ],
      }),
      createUploadAndQuote: async () => ({ ok: true, uploadId, quoteId }),
      optionalSteps: {
        seedMessages: async () => {
          // noop
        },
        seedDestinations: async () => new Map(),
        seedOffers: async () => {
          throw new Error("offers insert boom");
        },
      },
    },
  );

  assert.deepStrictEqual(result, { ok: true, quoteId });
  console.log("demoSeedFailSoftOptionalStep tests passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

