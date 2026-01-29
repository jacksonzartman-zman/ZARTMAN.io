export type ProviderImportActionState =
  | { ok: true; message: string; createdCount: number }
  | { ok: false; error: string };

