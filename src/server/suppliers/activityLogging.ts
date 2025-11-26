import type { PostgrestError } from "@supabase/supabase-js";

export type SupplierActivityLogContext = {
  loader?: string | null;
  supplierId?: string | null;
  supplierEmail?: string | null;
};

export type SupplierActivityQueryFailure = Error & {
  query?: string | null;
  supabaseError?: unknown;
};

export function isSupplierActivityQueryFailure(
  error: unknown,
): error is SupplierActivityQueryFailure {
  return Boolean(
    error &&
      typeof error === "object" &&
      ("query" in error || "supabaseError" in error),
  );
}

export function toSupplierActivityQueryError(
  query: string,
  error: unknown,
): SupplierActivityQueryFailure {
  if (isSupplierActivityQueryFailure(error)) {
    if (!error.query) {
      error.query = query;
    }
    if (error.supabaseError === undefined) {
      error.supabaseError = error;
    }
    return error;
  }

  if (error instanceof Error) {
    return Object.assign(error, {
      query,
      supabaseError: (error as SupplierActivityQueryFailure).supabaseError ?? error,
    });
  }

  const fallbackMessage =
    typeof error === "string"
      ? error
      : error === null || error === undefined
        ? "Unknown supplier activity error"
        : JSON.stringify(error);

  return Object.assign(new Error(fallbackMessage), {
    query,
    supabaseError: error,
  });
}

export function resolveSupplierActivityQuery(
  error: unknown,
  fallback: string,
): string {
  if (isSupplierActivityQueryFailure(error) && error.query) {
    return error.query;
  }
  return fallback;
}

type SupplierActivityLogArgs = SupplierActivityLogContext & {
  query: string;
  error: unknown;
  stage?: string | null;
};

type SupabaseErrorPayload = {
  code: string | null;
  message: string;
  details: string | null;
  hint: string | null;
};

export function logSupplierActivityQueryFailure(args: SupplierActivityLogArgs) {
  console.error("[supplier activity] quote query failed", {
    loader: args.loader ?? null,
    supplierId: args.supplierId ?? null,
    supplierEmail: args.supplierEmail ?? null,
    query: args.query,
    stage: args.stage ?? null,
    supabaseError: extractSupabaseErrorPayload(
      isSupplierActivityQueryFailure(args.error) && args.error.supabaseError
        ? args.error.supabaseError
        : args.error,
    ),
  });
}

function extractSupabaseErrorPayload(error: unknown): SupabaseErrorPayload {
  if (isPostgrestError(error)) {
    return {
      code: error.code ?? null,
      message: error.message ?? "Supabase error",
      details: error.details ?? null,
      hint: error.hint ?? null,
    };
  }

  if (error instanceof Error) {
    const anyError = error as unknown as Record<string, unknown>;
    return {
      code: typeof anyError.code === "string" ? (anyError.code as string) : null,
      message: error.message,
      details:
        typeof anyError.details === "string"
          ? (anyError.details as string)
          : null,
      hint:
        typeof anyError.hint === "string" ? (anyError.hint as string) : null,
    };
  }

  if (typeof error === "object" && error !== null) {
    const maybe = error as Record<string, unknown>;
    const message =
      typeof maybe.message === "string"
        ? (maybe.message as string)
        : JSON.stringify(maybe);
    return {
      code: typeof maybe.code === "string" ? (maybe.code as string) : null,
      message,
      details:
        typeof maybe.details === "string"
          ? (maybe.details as string)
          : null,
      hint: typeof maybe.hint === "string" ? (maybe.hint as string) : null,
    };
  }

  return {
    code: null,
    message:
      error === null || error === undefined ? "Unknown error" : String(error),
    details: null,
    hint: null,
  };
}

function isPostgrestError(error: unknown): error is PostgrestError {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      "message" in error &&
      "details" in error &&
      "hint" in error,
  );
}
