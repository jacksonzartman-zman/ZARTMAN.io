import type { SupabaseClient } from "@supabase/supabase-js";
import path from "node:path";

type ResolveAttempts = {
  triedBuckets: string[];
  listCalls: number;
  triedPrefixes: Array<{ bucket: string; prefix: string }>;
  triedSearchTermsCount: number;
};

export type ResolveStoredObjectResult = {
  bucket: string | null;
  path: string | null;
  found: boolean;
  attempts: ResolveAttempts;
  candidatesCount: number;
};

function normalizeBucket(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePath(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw.replace(/^\/+/, "");
}

function ensurePrefix(value: string): string {
  const raw = normalizePath(value);
  if (!raw) return "";
  return raw.endsWith("/") ? raw : `${raw}/`;
}

function joinPrefix(prefix: string, name: string): string {
  const p = ensurePrefix(prefix);
  const n = normalizePath(name);
  return (p ? `${p}${n}` : n).replace(/\/{2,}/g, "/");
}

function bucketAliases(bucket: string): string[] {
  if (bucket === "cad_uploads") return ["cad-uploads"];
  if (bucket === "cad-uploads") return ["cad_uploads"];
  if (bucket === "cad_previews") return ["cad-previews"];
  if (bucket === "cad-previews") return ["cad_previews"];
  return [];
}

function addUnique(list: string[], value: string) {
  const v = normalizeBucket(value);
  if (!v) return;
  if (!list.includes(v)) list.push(v);
}

function stripBucketPrefixOnce(inputPath: string, bucket: string): string {
  const p = normalizePath(inputPath);
  const b = normalizeBucket(bucket);
  if (!p || !b) return p;
  const prefix = `${b}/`;
  return p.startsWith(prefix) ? p.slice(prefix.length) : p;
}

function uniqNonEmpty(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const v of values) {
    const s = typeof v === "string" ? v.trim() : "";
    if (!s) continue;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

function buildSearchTerms(input: { requestedBasename: string; filenameHint?: string | null }): string[] {
  const base = normalizePath(input.requestedBasename);
  const hint = typeof input.filenameHint === "string" ? input.filenameHint.trim() : "";

  // Try multiple variants; Storage `search` may be case-sensitive.
  return uniqNonEmpty([
    // a) basename from requestedPath (as-is)
    base || null,
    // b) basename lowercased
    base ? base.toLowerCase() : null,
    // c) basename uppercased (or filename hint as-is)
    base ? base.toUpperCase() : null,
    hint || null,
    // d) filename hint as-is and lowercased (when provided)
    hint ? hint.toLowerCase() : null,
  ]);
}

function keyMatchesCaseInsensitive(input: { key: string; baseLower: string }): boolean {
  const keyLower = normalizePath(input.key).toLowerCase();
  const baseLower = input.baseLower;
  if (!keyLower || !baseLower) return false;

  if (keyLower.endsWith(`/${baseLower}`)) return true;
  if (keyLower.endsWith(baseLower)) return true;
  return keyLower.includes(baseLower);
}

export async function resolveStoredObject(input: {
  serviceSupabase: SupabaseClient;
  requestedBucket: string;
  requestedPath: string;
  quoteId?: string | null;
  quoteFileId?: string | null;
  filename?: string | null;
  requestedBasename?: string | null;
  rid?: string;
}): Promise<ResolveStoredObjectResult> {
  const requestedBucket = normalizeBucket(input.requestedBucket);
  const rid = typeof input.rid === "string" ? input.rid : undefined;

  // Normalize path candidates (strict/minimal; do not relocate).
  let requestedPath = normalizePath(input.requestedPath);
  if (requestedBucket) {
    requestedPath = stripBucketPrefixOnce(requestedPath, requestedBucket);
  }

  const base = path.posix.basename(requestedPath);

  const attempts: ResolveAttempts = {
    triedBuckets: [],
    triedPrefixesCount: 0,
    listCalls: 0,
    listErrors: [],
    triedPrefixes: [],
  };

  const finish = (result: ResolveStoredObjectResult) => {
    console.log("[cad-preview]", {
      stage: "storage_resolver",
      requestedBucket: requestedBucket || null,
      requestedPath: requestedPath || null,
      triedBuckets: attempts.triedBuckets,
      triedPrefixesCount: attempts.triedPrefixesCount,
      candidatesCount: result.candidatesCount,
      resolvedBucket: result.bucket,
      resolvedPath: result.path,
      rid,
    });
    return result;
  };

  if (!requestedBucket || !requestedPath || !base) {
    return finish({
      bucket: null,
      path: null,
      found: false,
      attempts,
      candidatesCount: 0,
    });
  }

  const quoteId = typeof input.quoteId === "string" ? input.quoteId.trim() : "";

  const buckets: string[] = [];
  addUnique(buckets, requestedBucket);
  for (const alias of bucketAliases(requestedBucket)) addUnique(buckets, alias);

  // Include intake ephemeral bucket constant (plus alias) when present.
  // The intake uploader uses `cad_uploads` in this repo; in some deployments it may differ.
  const INTAKE_EPHEMERAL_BUCKET = "cad_uploads";
  addUnique(buckets, INTAKE_EPHEMERAL_BUCKET);
  for (const alias of bucketAliases(INTAKE_EPHEMERAL_BUCKET)) addUnique(buckets, alias);

  const MAX_LIST_CALLS = 12;
  const LIST_LIMIT = 100;

  type Candidate = { bucket: string; key: string };
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  const addCandidate = (bucket: string, key: string) => {
    const b = normalizeBucket(bucket);
    const k = normalizePath(key);
    if (!b || !k) return;
    const id = `${b}:${k}`;
    if (seen.has(id)) return;
    seen.add(id);
    candidates.push({ bucket: b, key: k });
  };

  const listOnce = async (bucket: string, prefix: string, search: string | null) => {
    if (attempts.listCalls >= MAX_LIST_CALLS) return;
    attempts.listCalls += 1;
    attempts.triedPrefixesCount += 1;
    attempts.triedPrefixes.push({ bucket, prefix });

    const listPrefix = normalizePath(prefix);
    try {
      const { data, error } = await input.serviceSupabase.storage.from(bucket).list(listPrefix, {
        limit: LIST_LIMIT,
        search: search ?? undefined,
        offset: 0,
        sortBy: { column: "name", order: "asc" },
      });

      if (error) {
        attempts.listErrors.push({
          bucket,
          prefix: listPrefix,
          message: typeof (error as any)?.message === "string" ? (error as any).message : String(error),
        });
        return;
      }

      const items = Array.isArray(data) ? (data as any[]) : [];
      for (const it of items) {
        const name = typeof it?.name === "string" ? it.name : "";
        if (!name) continue;
        addCandidate(bucket, joinPrefix(listPrefix, name));
      }
    } catch (e) {
      attempts.listErrors.push({
        bucket,
        prefix: listPrefix,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  for (const bucket of buckets) {
    if (attempts.listCalls >= MAX_LIST_CALLS) break;
    attempts.triedBuckets.push(bucket);

    // a) list("uploads/", { search: base, limit: 100 })
    await listOnce(bucket, "uploads/", base);
    if (attempts.listCalls >= MAX_LIST_CALLS) break;

    // b) if quoteId: list(quote_uploads/${quoteId}/, { search: base, limit: 100 })
    if (quoteId) {
      await listOnce(bucket, `quote_uploads/${quoteId}/`, base);
      if (attempts.listCalls >= MAX_LIST_CALLS) break;
    }

    // c) if quoteId: list(quotes/${quoteId}/, { search: base, limit: 100 })
    if (quoteId) {
      await listOnce(bucket, `quotes/${quoteId}/`, base);
      if (attempts.listCalls >= MAX_LIST_CALLS) break;
    }

    // d) list("", { limit: 100 }) to discover top-level “folders”; probe likely candidates.
    if (attempts.listCalls >= MAX_LIST_CALLS) break;
    const topLevel: string[] = [];
    try {
      const { data, error } = await input.serviceSupabase.storage.from(bucket).list("", {
        limit: LIST_LIMIT,
        offset: 0,
        sortBy: { column: "name", order: "asc" },
      });
      attempts.listCalls += 1;
      attempts.triedPrefixesCount += 1;
      attempts.triedPrefixes.push({ bucket, prefix: "" });
      if (!error) {
        const items = Array.isArray(data) ? (data as any[]) : [];
        for (const it of items) {
          const name = typeof it?.name === "string" ? it.name : "";
          if (name) topLevel.push(name);
        }
      } else {
        attempts.listErrors.push({
          bucket,
          prefix: "",
          message: typeof (error as any)?.message === "string" ? (error as any).message : String(error),
        });
      }
    } catch (e) {
      attempts.listCalls += 1;
      attempts.triedPrefixesCount += 1;
      attempts.triedPrefixes.push({ bucket, prefix: "" });
      attempts.listErrors.push({
        bucket,
        prefix: "",
        message: e instanceof Error ? e.message : String(e),
      });
    }

    if (attempts.listCalls >= MAX_LIST_CALLS) break;

    const folderNeedles = ["quote", "rfq", "intake"];
    const filtered = topLevel
      .map((n) => n.trim())
      .filter(Boolean)
      .filter((name) => {
        const lower = name.toLowerCase();
        if (quoteId && lower.includes(quoteId.toLowerCase())) return true;
        return folderNeedles.some((needle) => lower.includes(needle));
      })
      .slice(0, 3); // strict: only probe a few folders

    for (const folder of filtered) {
      if (attempts.listCalls >= MAX_LIST_CALLS) break;
      await listOnce(bucket, `${folder}/`, base);
    }
  }

  // Rank candidates.
  const requestedKey = requestedPath;
  const scored = candidates.map((c, idx) => {
    const exact = c.key === requestedKey;
    const endsWithBase = c.key === base || c.key.endsWith(`/${base}`);
    const prefersRequestedBucket = c.bucket === requestedBucket;
    const score = [
      exact ? 0 : 1,
      endsWithBase ? 0 : 1,
      prefersRequestedBucket ? 0 : 1,
      idx,
    ] as const;
    return { c, score };
  });

  scored.sort((a, b) => {
    for (let i = 0; i < a.score.length; i += 1) {
      const diff = a.score[i] - b.score[i];
      if (diff !== 0) return diff;
    }
    return 0;
  });

  const best = scored[0]?.c ?? null;

  return finish({
    bucket: best?.bucket ?? null,
    path: best?.key ?? null,
    found: Boolean(best?.bucket && best?.key),
    attempts,
    candidatesCount: candidates.length,
  });
}

