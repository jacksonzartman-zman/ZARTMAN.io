import { supabaseServer } from "@/lib/supabaseServer";
import { schemaGate } from "@/server/db/schemaContract";

export const PROVIDER_TYPES = [
  "marketplace",
  "direct_supplier",
  "factory",
  "broker",
] as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const PROVIDER_QUOTING_MODES = ["manual", "email", "api"] as const;
export type ProviderQuotingMode = (typeof PROVIDER_QUOTING_MODES)[number];

export type ProviderRow = {
  id: string;
  name: string;
  provider_type: ProviderType;
  quoting_mode: ProviderQuotingMode;
  is_active: boolean;
  website: string | null;
  notes: string | null;
  created_at: string;
};

const PROVIDERS_TABLE = "providers";
const PROVIDER_COLUMNS = [
  "id",
  "name",
  "provider_type",
  "quoting_mode",
  "is_active",
  "website",
  "notes",
  "created_at",
] as const;
const PROVIDER_SELECT = PROVIDER_COLUMNS.join(",");

export async function getActiveProviders(): Promise<ProviderRow[]> {
  const supported = await schemaGate({
    enabled: true,
    relation: PROVIDERS_TABLE,
    requiredColumns: [...PROVIDER_COLUMNS],
    warnPrefix: "[providers]",
    warnKey: "providers:get_active",
  });
  if (!supported) {
    return [];
  }

  try {
    const { data, error } = await supabaseServer
      .from(PROVIDERS_TABLE)
      .select(PROVIDER_SELECT)
      .eq("is_active", true)
      .order("name", { ascending: true })
      .returns<ProviderRow[]>();

    if (error) {
      console.warn("[providers] getActiveProviders failed", { error });
      return [];
    }

    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn("[providers] getActiveProviders crashed", { error });
    return [];
  }
}
