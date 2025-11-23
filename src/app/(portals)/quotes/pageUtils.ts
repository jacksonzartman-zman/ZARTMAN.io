import type { ReadonlyURLSearchParams } from "next/navigation";

export type SearchParamsLike =
  | ReadonlyURLSearchParams
  | URLSearchParams
  | Record<string, string | string[] | undefined>
  | undefined;

export async function resolveMaybePromise<T>(
  value?: Promise<T> | T,
): Promise<T | undefined> {
  if (typeof value === "undefined") {
    return undefined;
  }

  return await value;
}

export function getSearchParamValue(
  params: SearchParamsLike,
  key: string,
): string | undefined {
  if (!params) {
    return undefined;
  }

  if (hasGetMethod(params)) {
    return params.get(key) ?? undefined;
  }

  const recordValue = (params as Record<string, string | string[] | undefined>)[
    key
  ];

  if (Array.isArray(recordValue)) {
    return recordValue[0];
  }

  return recordValue;
}

function hasGetMethod(
  params: SearchParamsLike,
): params is URLSearchParams | ReadonlyURLSearchParams {
  return typeof (params as URLSearchParams)?.get === "function";
}

export function normalizeEmailInput(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function formatQuoteId(id: string | null | undefined): string {
  if (!id) {
    return "Quote";
  }

  return id.startsWith("Q-") ? id : `#${id.slice(0, 6)}`;
}

export function getFirstParamValue(
  value?: string | string[] | null,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value ?? undefined;
}
