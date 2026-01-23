export const PROVIDER_DISPATCH_MODES = ["email", "web_form", "api"] as const;

export type ProviderDispatchMode = (typeof PROVIDER_DISPATCH_MODES)[number];

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

export function resolveProviderDispatchMode(provider: {
  dispatch_mode?: unknown;
  quoting_mode?: unknown;
}): ProviderDispatchMode | null {
  return resolveDispatchModeValue(provider.dispatch_mode, provider.quoting_mode);
}
