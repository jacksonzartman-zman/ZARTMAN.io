export const PRICING_PRIORS_SCHEMA = {
  priors: {
    relation: "pricing_priors",
    requiredColumns: [
      "id",
      "technology",
      "material_canon",
      "parts_bucket",
      "n",
      "p10",
      "p50",
      "p90",
      "updated_at",
    ],
  },
} as const;

export async function hasPricingPriorsSchema(): Promise<boolean> {
  // NOTE: imported lazily to keep this module safe to import in unit tests
  // (which may not have Supabase env vars configured).
  const { schemaGate } = await import("@/server/db/schemaContract");

  return await schemaGate({
    enabled: true,
    relation: PRICING_PRIORS_SCHEMA.priors.relation,
    requiredColumns: [...PRICING_PRIORS_SCHEMA.priors.requiredColumns],
    warnPrefix: "[pricing_priors]",
    warnKey: "pricing_priors:priors",
  });
}

