export type QuoteMessageFormState = {
  ok: boolean;
  message?: string | null;
  error?: string | null;
  fieldErrors?: {
    body?: string;
  };
};
