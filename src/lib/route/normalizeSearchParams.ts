export type SearchParamsInput =
  | URLSearchParams
  | Record<string, string | string[] | undefined>
  | undefined;

export function normalizeSearchParams(input: SearchParamsInput): URLSearchParams {
  if (!input) return new URLSearchParams();
  if (input instanceof URLSearchParams) return input;

  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v != null) usp.append(key, v);
      }
    } else if (value != null) {
      usp.set(key, value);
    }
  }
  return usp;
}
