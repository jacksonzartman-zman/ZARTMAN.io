import { PROVIDER_DISPATCH_MODES } from "@/server/providers";
import type { ProviderDispatchMode, ProviderRow } from "@/server/providers";

const DISPATCH_MODE_SET = new Set<ProviderDispatchMode>(PROVIDER_DISPATCH_MODES);

function normalizeDispatchMode(value: unknown): ProviderDispatchMode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (DISPATCH_MODE_SET.has(normalized as ProviderDispatchMode)) {
    return normalized as ProviderDispatchMode;
  }
  return null;
}

export function resolveDispatchModeValue(
  dispatchMode: unknown,
  quotingMode: unknown,
): ProviderDispatchMode | null {
  return normalizeDispatchMode(dispatchMode) ?? normalizeDispatchMode(quotingMode);
}

export function resolveProviderDispatchMode(provider: ProviderRow): ProviderDispatchMode | null {
  return resolveDispatchModeValue(provider.dispatch_mode, provider.quoting_mode);
}
