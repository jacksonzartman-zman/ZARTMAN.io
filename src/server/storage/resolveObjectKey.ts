import type { SupabaseClient } from "@supabase/supabase-js";
import path from "node:path";

type StorageObjectRow = {
  name: string;
  bucket_id: string;
  id?: string;
  created_at?: string;
  metadata?: unknown;
};

function normalizePath(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw.replace(/^\/+/, "").replace(/\/{2,}/g, "/");
}

function escapeLike(input: string): string {
  // PostgREST uses LIKE patterns; keep this minimal and safe.
  return input.replace(/[%_\\]/g, (m) => `\\${m}`);
}

function legacyBucketPrefix(bucket: string): string | null {
  if (bucket === "cad_uploads") return "cad-uploads";
  if (bucket === "cad_previews") return "cad-previews";
  return null;
}

function buildExactCandidates(bucket: string, requestedPath: string): string[] {
  const normalized = normalizePath(requestedPath);
  const candidates: string[] = [];
  if (normalized) candidates.push(normalized);

  const bucketPrefix = `${bucket}/`;
  if (normalized.startsWith(bucketPrefix)) {
    candidates.push(normalized.slice(bucketPrefix.length));
  }

  const legacy = legacyBucketPrefix(bucket);
  if (legacy) {
    const legacyPrefix = `${legacy}/`;
    if (normalized.startsWith(legacyPrefix)) {
      candidates.push(normalized.slice(legacyPrefix.length));
    }
  }

  // De-dupe, preserve order.
  return Array.from(new Set(candidates.filter(Boolean)));
}

function rankCandidates(input: { requestedBase: string; candidates: StorageObjectRow[] }): StorageObjectRow[] {
  const base = input.requestedBase;
  const scored = input.candidates.map((c) => {
    const endsWithBase = c.name.endsWith(`/${base}`) || c.name === base;
    const containsUploads = c.name.includes("/uploads/");
    return {
      c,
      score: [
        endsWithBase ? 0 : 1,
        containsUploads ? 0 : 1,
      ] as const,
    };
  });

  scored.sort((a, b) => {
    if (a.score[0] !== b.score[0]) return a.score[0] - b.score[0];
    if (a.score[1] !== b.score[1]) return a.score[1] - b.score[1];
    return a.c.name.localeCompare(b.c.name);
  });

  return scored.map((s) => s.c);
}

export async function resolveStorageObjectKey(input: {
  supabaseService: SupabaseClient;
  bucket: "cad_uploads" | "cad_previews";
  requestedPath: string;
  quoteId?: string | null;
  quoteFileId?: string | null;
  filename?: string | null;
  requestId?: string;
}): Promise<{ resolvedPath: string; candidatesCount: number } | null> {
  const requestedPath = normalizePath(input.requestedPath);
  const base = path.posix.basename(requestedPath);

  const log = (extra: Record<string, unknown>) => {
    console.log("[cad-preview]", {
      rid: input.requestId,
      stage: "storage_object_resolver",
      bucket: input.bucket,
      requestedPath,
      base,
      ...extra,
    });
  };

  if (!requestedPath || !base) {
    log({ candidatesCount: 0, resolvedPath: null, reason: "missing_path_or_base" });
    return null;
  }

  // 1) Exact matches (stop early on a single high-confidence match).
  const exactCandidates = buildExactCandidates(input.bucket, requestedPath);
  for (const candidate of exactCandidates) {
    const { data, error } = await input.supabaseService
      .schema("storage")
      .from("objects")
      .select("name,bucket_id,id,created_at,metadata")
      .eq("bucket_id", input.bucket)
      .eq("name", candidate)
      .maybeSingle<StorageObjectRow>();

    if (error) {
      // If catalog query fails, do not crash the request; just log and continue.
      log({
        candidatesCount: 0,
        resolvedPath: null,
        exactCandidate: candidate,
        error: { message: error.message, code: (error as any)?.code },
      });
      continue;
    }

    if (data?.name) {
      log({ candidatesCount: 1, resolvedPath: data.name, match: "exact" });
      return { resolvedPath: data.name, candidatesCount: 1 };
    }
  }

  // 2) Suffix/basename matches (targeted, limited).
  const baseEsc = escapeLike(base);
  const candidates: StorageObjectRow[] = [];

  const addRows = (rows: StorageObjectRow[] | null | undefined) => {
    const list = Array.isArray(rows) ? rows : [];
    for (const row of list) {
      if (row?.name && row.bucket_id === input.bucket) {
        candidates.push(row);
      }
    }
  };

  const suffixQuery = await input.supabaseService
    .schema("storage")
    .from("objects")
    .select("name,bucket_id,id,created_at,metadata")
    .eq("bucket_id", input.bucket)
    .ilike("name", `%/${baseEsc}`)
    .limit(10);
  if (!suffixQuery.error) addRows(suffixQuery.data as any);

  const looseQuery = await input.supabaseService
    .schema("storage")
    .from("objects")
    .select("name,bucket_id,id,created_at,metadata")
    .eq("bucket_id", input.bucket)
    .ilike("name", `%${baseEsc}`)
    .limit(10);
  if (!looseQuery.error) addRows(looseQuery.data as any);

  const quoteId = typeof input.quoteId === "string" ? input.quoteId.trim() : "";
  if (quoteId) {
    const quoteEsc = escapeLike(quoteId);
    const quoteQuery = await input.supabaseService
      .schema("storage")
      .from("objects")
      .select("name,bucket_id,id,created_at,metadata")
      .eq("bucket_id", input.bucket)
      .ilike("name", `%${quoteEsc}%${baseEsc}`)
      .limit(10);
    if (!quoteQuery.error) addRows(quoteQuery.data as any);
  }

  // De-dupe candidates by name.
  const uniqueByName = new Map<string, StorageObjectRow>();
  for (const row of candidates) {
    if (!uniqueByName.has(row.name)) uniqueByName.set(row.name, row);
  }
  const unique = Array.from(uniqueByName.values());
  const candidatesCount = unique.length;

  if (candidatesCount === 0) {
    log({ candidatesCount: 0, resolvedPath: null });
    return null;
  }

  const ranked = rankCandidates({ requestedBase: base, candidates: unique });
  const best = ranked[0]?.name ?? null;
  log({ candidatesCount, resolvedPath: best });
  return best ? { resolvedPath: best, candidatesCount } : null;
}

