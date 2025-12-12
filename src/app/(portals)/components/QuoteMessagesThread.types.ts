export type QuoteMessageFormState = {
  ok: boolean;
  message?: string | null;
  error?: string | null;
  reason?:
    | "missing_profile"
    | "access_denied"
    | "rls_denied"
    | "unknown"
    | null;
  fieldErrors?: {
    body?: string;
  };
};
