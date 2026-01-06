import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveStoredObject } from "@/server/storage/resolveStoredObject";

export async function resolveStorageObjectKey(input: {
  supabaseService: SupabaseClient;
  bucket: "cad_uploads" | "cad_previews";
  requestedPath: string;
  quoteId?: string | null;
  quoteFileId?: string | null;
  filename?: string | null;
  requestId?: string;
}): Promise<{ resolvedPath: string; candidatesCount: number } | null> {
  // Legacy API retained for compatibility; PostgREST access to `storage.objects` is
  // blocked in production (PGRST106), so this delegates to the Storage API resolver.
  const resolved = await resolveStoredObject({
    serviceSupabase: input.supabaseService,
    requestedBucket: input.bucket,
    requestedPath: input.requestedPath,
    quoteId: input.quoteId,
    quoteFileId: input.quoteFileId,
    filename: input.filename,
    rid: input.requestId,
  });

  // This legacy helper can only return a path; if we resolved into a different bucket,
  // callers should use `resolveStoredObject` directly.
  if (!resolved.found || !resolved.path || resolved.bucket !== input.bucket) {
    return null;
  }
  return { resolvedPath: resolved.path, candidatesCount: resolved.candidatesCount };
}

