import { createClient } from "@supabase/supabase-js";

/**
 * Backfill canonical quote file rows for portal previews (safe + idempotent).
 *
 * ### Codespace / local runbook (copy/paste)
 * - Install deps:
 *   - `npm ci`
 * - Ensure tsx is present (only if missing):
 *   - `npm i -D tsx`
 * - Dry-run:
 *   - `npx tsx scripts/backfill-canonical-quote-files.ts --dryRun --limit 5 --verbose`
 * - Apply:
 *   - `npx tsx scripts/backfill-canonical-quote-files.ts --limit 500 --verbose`
 *
 * ### Required env (service role)
 * - `NEXT_PUBLIC_SUPABASE_URL`
 * - `SUPABASE_SERVICE_ROLE_KEY`
 *
 * ### What it does
 * - Targets quotes with **0 canonical rows** in `files_valid` (fallback `files`).
 * - Derives filename hints from:
 *   - `quotes.file_name` / `quotes.file_names`
 *   - (optional) `quote_upload_files.filename` if that table exists
 * - Searches Storage objects via `supabase.schema("storage").from("objects")` in:
 *   - bucket `cad_uploads`
 *   - bucket `cad-uploads`
 * - Matches historical key patterns (bounded queries):
 *   - `uploads/intake/<uid>/**` (deep)
 *   - `uploads/<timestamp-or-random>-<anything>-<filename>`
 *   - `uploads/<quoteId>/**`
 *   - `quote_uploads/<quoteId>/**`
 *   - `quotes/<quoteId>/**`
 * - Inserts canonical rows into `files_valid` (fallback `files`) with:
 *   - quote_id, filename, bucket_id (normalized to `cad_uploads`), storage_path (exact object key)
 *
 * ### Verification SQL (before/after)
 * - Quotes still missing canonical files:
 *
 *   select q.id, q.created_at
 *   from public.quotes q
 *   where not exists (select 1 from public.files_valid f where f.quote_id = q.id)
 *     and not exists (select 1 from public.files f where f.quote_id = q.id)
 *   order by q.created_at desc
 *   limit 50;
 */

type QuoteRow = {
  id: string;
  upload_id: string | null;
  customer_id: string | null;
  customer_email: string | null;
  file_name: string | null;
  file_names: string[] | null;
  created_at?: string | null;
};

type UploadRow = {
  id: string;
  customer_id: string | null;
  file_path: string | null;
};

type CustomerRow = {
  id: string;
  user_id: string | null;
  email: string | null;
};

type StorageObjectRow = {
  id: string;
  bucket_id: string;
  name: string;
  created_at: string | null;
  metadata?: Record<string, unknown> | null;
};

type CanonicalFileInsertRow = {
  quote_id: string;
  filename: string;
  mime: string;
  storage_path: string;
  bucket_id: string;
  size_bytes?: number | null;
  created_at?: string | null;
};

const CANONICAL_BUCKET = "cad_uploads";
const SEARCH_BUCKETS = ["cad_uploads", "cad-uploads"] as const;

function canonicalizeBucketId(input: unknown): string {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return "";
  if (raw === "cad-uploads") return "cad_uploads";
  if (raw === "cad_uploads") return "cad_uploads";
  return raw;
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePath(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw.replace(/^\/+/, "");
}

function normalizeStorageObjectKey(bucket: string, path: string): string {
  const normalizedBucket = canonicalizeBucketId(bucket) || bucket;
  let key = normalizePath(path);
  if (!key) return "";
  // If callers accidentally pass `bucket/key`, strip the bucket prefix.
  if (normalizedBucket && key.startsWith(`${normalizedBucket}/`)) {
    key = key.slice(normalizedBucket.length + 1);
  } else if (normalizedBucket === "cad_uploads" && key.startsWith("cad-uploads/")) {
    key = key.slice("cad-uploads/".length);
  }
  key = normalizePath(key);
  return key;
}

function basename(path: string): string {
  const normalized = normalizePath(path);
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function normalizeFilenameForMatch(value: string): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, " ")
    .replace(/[^\w.\- ]+/g, "") // drop special chars, keep dots/hyphens/spaces
    .replace(/\s+/g, " ")
    .replace(/^ +| +$/g, "");
}

function sanitizeForLikeNeedle(value: string): string {
  // Prevent wildcard injection in ilike patterns by stripping `%` and `_`.
  return normalizeFilenameForMatch(value).replace(/[%_]/g, "");
}

function stripTimestampPrefixes(fileBaseName: string): string {
  const raw = (fileBaseName ?? "").trim();
  if (!raw) return raw;
  // Common patterns:
  // - <ts>-<rand>-<filename>
  // - <ts>-<filename>
  // - <ts>_<filename>
  return raw
    .replace(/^\d{10,13}-[0-9a-f]{6,}-/i, "")
    .replace(/^\d{10,13}[-_]/, "");
}

function mimeFromFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".stl")) return "model/stl";
  if (lower.endsWith(".obj")) return "text/plain";
  if (lower.endsWith(".glb")) return "model/gltf-binary";
  if (lower.endsWith(".step") || lower.endsWith(".stp")) return "application/step";
  if (lower.endsWith(".iges") || lower.endsWith(".igs")) return "model/iges";
  if (lower.endsWith(".zip")) return "application/zip";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".dwg")) return "application/acad";
  if (lower.endsWith(".dxf")) return "application/dxf";
  return "application/octet-stream";
}

function resolveBestFilenameForObject(input: {
  objectKey: string;
  legacyNames: string[];
}): string {
  const base = basename(input.objectKey);
  const baseNorm = normalizeFilenameForMatch(base);
  const strippedNorm = normalizeFilenameForMatch(stripTimestampPrefixes(base));

  const candidates = Array.from(new Set((input.legacyNames ?? []).map((n) => n.trim()).filter(Boolean)));
  const ranked = candidates
    .map((legacy) => {
      const target = normalizeFilenameForMatch(legacy);
      const score =
        target && (baseNorm === target || strippedNorm === target)
          ? 3
          : target && (baseNorm.endsWith(`-${target}`) || baseNorm.endsWith(target))
            ? 2
            : target && (strippedNorm.endsWith(`-${target}`) || strippedNorm.endsWith(target))
              ? 2
              : 0;
      return { legacy, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.legacy ?? (base || input.objectKey);
}

function resolveMimeAndSizeFromObject(input: {
  filename: string;
  metadata?: Record<string, unknown> | null;
}): { mime: string; size_bytes: number | null } {
  const meta = input.metadata ?? null;
  const fromMetaMime =
    meta && typeof meta["mimetype"] === "string" && meta["mimetype"].trim()
      ? String(meta["mimetype"]).trim()
      : meta && typeof meta["contentType"] === "string" && meta["contentType"].trim()
        ? String(meta["contentType"]).trim()
        : null;
  const mime = fromMetaMime ?? mimeFromFileName(input.filename) ?? "application/octet-stream";

  const size =
    (meta ? asNumber(meta["size"]) : null) ??
    (meta ? asNumber(meta["contentLength"]) : null) ??
    (meta ? asNumber(meta["ContentLength"]) : null) ??
    null;

  return { mime, size_bytes: size };
}

function parseArgs(argv: string[]) {
  const args = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(key, next);
      i += 1;
    } else {
      args.set(key, true);
    }
  }
  return {
    quoteId: typeof args.get("quoteId") === "string" ? String(args.get("quoteId")) : null,
    limit:
      typeof args.get("limit") === "string" && Number.isFinite(Number(args.get("limit")))
        ? Number(args.get("limit"))
        : 200,
    dryRun: Boolean(args.get("dryRun")),
    verbose: Boolean(args.get("verbose")),
  };
}

function storageObjectsQuery(supabase: ReturnType<typeof createClient>) {
  // IMPORTANT: "storage.objects" must be queried via schema('storage').from('objects') in PostgREST.
  // Using from("storage.objects") will silently fail in many environments.
  return (supabase as any).schema ? (supabase as any).schema("storage").from("objects") : null;
}

async function detectCanonicalTable(supabase: ReturnType<typeof createClient>) {
  // Prefer files_valid if the table exists in this environment.
  try {
    const probe = await supabase.from("files_valid").select("id").limit(1);
    if (!probe.error) return "files_valid" as const;
  } catch {
    // ignore
  }
  return "files" as const;
}

async function loadQuote(supabase: ReturnType<typeof createClient>, quoteId: string): Promise<QuoteRow | null> {
  const { data, error } = await supabase
    .from("quotes")
    .select("id,upload_id,customer_id,customer_email,file_name,file_names,created_at")
    .eq("id", quoteId)
    .maybeSingle<QuoteRow>();
  if (error || !data?.id) return null;
  return data;
}

async function loadQuotesNeedingCheck(
  supabase: ReturnType<typeof createClient>,
  limit: number,
): Promise<QuoteRow[]> {
  // Must-have scope:
  // - Target quotes that have legacy filenames (quotes.file_name OR quotes.file_names not null/empty).
  // We filter "not null" at the DB layer, then drop empty arrays/strings in JS.
  const { data, error } = await supabase
    .from("quotes")
    .select("id,upload_id,customer_id,customer_email,file_name,file_names,created_at")
    .or("file_name.not.is.null,file_names.not.is.null")
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<QuoteRow[]>();
  if (error || !Array.isArray(data)) return [];
  return data;
}

async function loadCanonicalCount(
  supabase: ReturnType<typeof createClient>,
  table: "files_valid" | "files",
  quoteId: string,
): Promise<number> {
  try {
    const { count, error } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("quote_id", quoteId);
    if (error) return 0;
    return typeof count === "number" ? count : 0;
  } catch {
    return 0;
  }
}

async function loadExistingCanonicalKeys(
  supabase: ReturnType<typeof createClient>,
  table: "files_valid" | "files",
  quoteId: string,
): Promise<Set<string>> {
  const keys = new Set<string>();
  const add = (bucket: string, path: string) => {
    const b = canonicalizeBucketId(bucket) || bucket;
    // Keep storage key "exact" (storage.objects.name) and only normalize leading slashes.
    const p = normalizePath(path);
    if (!b || !p) return;
    keys.add(`${b}:${p}`);
  };

  try {
    const { data, error } = await supabase
      .from(table)
      .select("bucket_id,storage_bucket_id,storage_path,file_path")
      .eq("quote_id", quoteId)
      .returns<
        Array<{
          bucket_id?: string | null;
          storage_bucket_id?: string | null;
          storage_path?: string | null;
          file_path?: string | null;
        }>
      >();
    if (error) return keys;
    for (const row of data ?? []) {
      const bucket =
        (typeof row.bucket_id === "string" && row.bucket_id) ||
        (typeof row.storage_bucket_id === "string" && row.storage_bucket_id) ||
        "";
      const path =
        (typeof row.storage_path === "string" && row.storage_path) ||
        (typeof row.file_path === "string" && row.file_path) ||
        "";
      if (bucket && path) add(bucket, path);
    }
  } catch {
    // ignore
  }
  return keys;
}

type QuoteUploadFileRow = {
  id: string;
  filename: string;
  path: string;
  extension: string | null;
  is_from_archive: boolean;
};

async function loadQuoteUploadFilenames(
  supabase: ReturnType<typeof createClient>,
  quoteId: string,
): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from("quote_upload_files")
      .select("id,filename,path,extension,is_from_archive")
      .eq("quote_id", quoteId)
      .limit(1000)
      .returns<QuoteUploadFileRow[]>();
    if (error || !Array.isArray(data)) return [];
    const names = data
      .map((row) => (typeof row?.filename === "string" ? row.filename.trim() : ""))
      .filter(Boolean);
    return Array.from(new Set(names));
  } catch {
    return [];
  }
}

async function resolveAuthUserIdForQuote(supabase: ReturnType<typeof createClient>, quote: QuoteRow): Promise<string | null> {
  const quoteCustomerId = normalizeId(quote.customer_id);
  const quoteEmail = typeof quote.customer_email === "string" ? quote.customer_email.trim().toLowerCase() : "";

  const loadCustomerById = async (id: string) => {
    const { data } = await supabase
      .from("customers")
      .select("id,user_id,email")
      .eq("id", id)
      .maybeSingle<CustomerRow>();
    const userId = normalizeId(data?.user_id);
    return userId || null;
  };

  const loadCustomerByEmail = async (email: string) => {
    const { data } = await supabase
      .from("customers")
      .select("id,user_id,email")
      .eq("email", email)
      .maybeSingle<CustomerRow>();
    const userId = normalizeId(data?.user_id);
    return userId || null;
  };

  if (quoteCustomerId) {
    const userId = await loadCustomerById(quoteCustomerId);
    if (userId) return userId;
  }

  if (quote.upload_id) {
    const { data: upload } = await supabase
      .from("uploads")
      .select("id,customer_id,file_path")
      .eq("id", quote.upload_id)
      .maybeSingle<UploadRow>();
    const uploadCustomerId = normalizeId(upload?.customer_id);
    if (uploadCustomerId) {
      const userId = await loadCustomerById(uploadCustomerId);
      if (userId) return userId;
    }
  }

  if (quoteEmail) {
    const userId = await loadCustomerByEmail(quoteEmail);
    if (userId) return userId;
  }

  return null;
}

async function loadUpload(supabase: ReturnType<typeof createClient>, uploadId: string): Promise<UploadRow | null> {
  const { data, error } = await supabase
    .from("uploads")
    .select("id,customer_id,file_path")
    .eq("id", uploadId)
    .maybeSingle<UploadRow>();
  if (error || !data?.id) return null;
  return data;
}

async function loadCandidateObjects(
  supabase: ReturnType<typeof createClient>,
  input: {
    quoteId: string;
    authUserId: string | null;
    upload: UploadRow | null;
    declaredNames: string[];
    verbose: boolean;
  },
): Promise<StorageObjectRow[]> {
  const candidates: StorageObjectRow[] = [];
  const seen = new Set<string>();

  const push = (rows: StorageObjectRow[] | null | undefined) => {
    for (const row of rows ?? []) {
      const id = normalizeId(row.id);
      const bucket = canonicalizeBucketId(row.bucket_id) || row.bucket_id;
      const name = normalizePath(row.name);
      if (!id || !bucket || !name) continue;
      const key = `${bucket}:${name}:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ ...row, id, bucket_id: bucket, name });
    }
  };

  const storageObjects = storageObjectsQuery(supabase);
  if (!storageObjects) {
    if (input.verbose) {
      console.warn("[backfill] storage schema client unavailable; cannot query storage.objects via PostgREST");
    }
    return candidates;
  }

  const quotePrefixes = [`uploads/${input.quoteId}/`, `quote_uploads/${input.quoteId}/`, `quotes/${input.quoteId}/`];

  const intakePrefix = input.authUserId ? `uploads/intake/${input.authUserId}/` : null;

  for (const bucketId of SEARCH_BUCKETS) {
    // 1) Intake uploads (preferred): uploads/intake/<auth.uid()>/...
    if (intakePrefix) {
      const { data } = await storageObjects
        .select("id,bucket_id,name,created_at,metadata")
        .eq("bucket_id", bucketId)
        .like("name", `${intakePrefix}%`)
        .order("created_at", { ascending: false })
        .limit(1000)
        .returns<StorageObjectRow[]>();
      push(data);
    }

    // 2) Quote-scoped known historical prefixes.
    for (const prefix of quotePrefixes) {
      const { data } = await storageObjects
        .select("id,bucket_id,name,created_at,metadata")
        .eq("bucket_id", bucketId)
        .like("name", `${prefix}%`)
        .order("created_at", { ascending: false })
        .limit(800)
        .returns<StorageObjectRow[]>();
      push(data);
    }

    // 3) If uploads.file_path points directly at an object, pull it in.
    const uploadPathRaw = typeof input.upload?.file_path === "string" ? input.upload.file_path.trim() : "";
    if (uploadPathRaw) {
      const normalized = normalizePath(uploadPathRaw);
      const withoutBucket =
        normalized.startsWith(`${bucketId}/`) ? normalized.slice(bucketId.length + 1) : normalized;
      const canonicalWithoutBucket =
        normalized.startsWith(`${CANONICAL_BUCKET}/`) ? normalized.slice(CANONICAL_BUCKET.length + 1) : normalized;
      const namesToTry = Array.from(new Set([normalized, withoutBucket, canonicalWithoutBucket]));
      for (const name of namesToTry) {
        if (!name) continue;
        const { data } = await storageObjects
          .select("id,bucket_id,name,created_at,metadata")
          .eq("bucket_id", bucketId)
          .eq("name", name)
          .limit(1)
          .returns<StorageObjectRow[]>();
        push(data);
      }
    }

    // 4) Bounded fallback: filename search under uploads/
    const nameSearchTargets = Array.from(new Set((input.declaredNames ?? []).filter(Boolean))).slice(0, 10);
    for (const declared of nameSearchTargets) {
      const needle = sanitizeForLikeNeedle(declared);
      if (!needle) continue;
      const { data } = await storageObjects
        .select("id,bucket_id,name,created_at,metadata")
        .eq("bucket_id", bucketId)
        .like("name", "uploads/%")
        .ilike("name", `%${needle}%`)
        .order("created_at", { ascending: false })
        .limit(250)
        .returns<StorageObjectRow[]>();
      push(data);
    }
  }

  if (input.verbose) {
    console.log("[backfill] candidate objects", {
      quoteId: input.quoteId,
      authUserId: input.authUserId,
      uploadId: input.upload?.id ?? null,
      candidates: candidates.length,
    });
  }

  return candidates;
}

function extractLegacyFilenames(quote: QuoteRow): string[] {
  const names: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim()) names.push(value.trim());
  };
  if (Array.isArray(quote.file_names)) {
    for (const name of quote.file_names) push(name);
  }
  if (names.length === 0) push(quote.file_name);
  return Array.from(new Set(names));
}

// NOTE: Previously the script picked one best object per legacy filename.
// Must-have behavior is now: insert all distinct storage matches safely,
// using legacy filenames only as hints for naming.

async function upsertCanonicalRows(params: {
  supabase: ReturnType<typeof createClient>;
  table: "files_valid" | "files";
  rows: CanonicalFileInsertRow[];
}): Promise<{ ok: boolean; inserted: number }> {
  const { supabase, table } = params;
  const rows = Array.isArray(params.rows) ? params.rows : [];
  if (rows.length === 0) return { ok: true, inserted: 0 };

  const variants = [
    // Canonical column names (preferred).
    (r: CanonicalFileInsertRow) => ({
      quote_id: r.quote_id,
      filename: r.filename,
      mime: r.mime,
      bucket_id: r.bucket_id,
      storage_path: r.storage_path,
      size_bytes: r.size_bytes ?? null,
      created_at: r.created_at ?? null,
    }),
    // Alternate bucket column.
    (r: CanonicalFileInsertRow) => ({
      quote_id: r.quote_id,
      filename: r.filename,
      mime: r.mime,
      storage_bucket_id: r.bucket_id,
      storage_path: r.storage_path,
      size_bytes: r.size_bytes ?? null,
      created_at: r.created_at ?? null,
    }),
    // Alternate path column.
    (r: CanonicalFileInsertRow) => ({
      quote_id: r.quote_id,
      filename: r.filename,
      mime: r.mime,
      bucket_id: r.bucket_id,
      file_path: r.storage_path,
      size_bytes: r.size_bytes ?? null,
      created_at: r.created_at ?? null,
    }),
    // Both alternates.
    (r: CanonicalFileInsertRow) => ({
      quote_id: r.quote_id,
      filename: r.filename,
      mime: r.mime,
      storage_bucket_id: r.bucket_id,
      file_path: r.storage_path,
      size_bytes: r.size_bytes ?? null,
      created_at: r.created_at ?? null,
    }),
  ] as const;

  // Insert best-effort with multiple schema variants.
  for (const mapper of variants) {
    const payload = rows.map(mapper);
    // Retry without created_at if the column doesn't exist.
    const payloadWithoutCreatedAt = payload.map((row) => {
      const copy = { ...(row as any) };
      delete copy.created_at;
      return copy;
    });

    try {
      const insertAttempt = await supabase.from(table).insert(payload as any);
      if (!insertAttempt.error) return { ok: true, inserted: rows.length };
    } catch {
      // ignore and try without created_at / next variant
    }

    try {
      const insertAttempt2 = await supabase.from(table).insert(payloadWithoutCreatedAt as any);
      if (!insertAttempt2.error) return { ok: true, inserted: rows.length };
    } catch {
      // ignore and try next mapping
    }
  }

  return { ok: false, inserted: 0 };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      "Missing env vars. Required: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const writeTable = await detectCanonicalTable(supabase);
  console.log("[backfill] starting", {
    writeTable,
    dryRun: args.dryRun,
    quoteId: args.quoteId,
    limit: args.limit,
  });

  let quotes: QuoteRow[] = [];
  if (args.quoteId) {
    const quote = await loadQuote(supabase, args.quoteId);
    quotes = quote ? [quote] : [];
  } else {
    quotes = await loadQuotesNeedingCheck(supabase, args.limit);
  }

  let scannedQuotes = 0;
  let eligibleQuotes = 0;
  let insertedRows = 0;
  let skippedExisting = 0;
  let missingStorageObjects = 0;

  for (const quote of quotes) {
    if (!quote?.id) continue;
    scannedQuotes += 1;

    const quoteId = quote.id;
    const legacyNames = extractLegacyFilenames(quote).map((n) => n.trim()).filter(Boolean);
    if (legacyNames.length === 0) {
      // Must-have: only target quotes with legacy filenames.
      continue;
    }

    const existingCount = await loadCanonicalCount(supabase, writeTable, quoteId);
    if (existingCount !== 0) {
      if (args.verbose) {
        console.log("[backfill] skip (already has canonical rows)", { quoteId, writeTable, existingCount });
      }
      continue;
    }
    eligibleQuotes += 1;

    const existingKeys = await loadExistingCanonicalKeys(supabase, writeTable, quoteId);

    const uploadId = normalizeId(quote.upload_id);
    const upload = uploadId ? await loadUpload(supabase, uploadId) : null;
    const authUserId = await resolveAuthUserIdForQuote(supabase, quote);
    const uploadFileNames = await loadQuoteUploadFilenames(supabase, quoteId);

    const declaredNames = Array.from(new Set([...(legacyNames ?? []), ...(uploadFileNames ?? [])]))
      .map((n) => (typeof n === "string" ? n.trim() : ""))
      .filter(Boolean);

    const objects = await loadCandidateObjects(supabase, {
      quoteId,
      authUserId,
      upload,
      declaredNames,
      verbose: args.verbose,
    });

    if (objects.length === 0) {
      missingStorageObjects += 1;
      if (args.verbose) {
        console.warn("[backfill] no storage matches", {
          quoteId,
          uploadId: uploadId || null,
          authUserId,
          legacyFileNames: legacyNames.length > 0 ? legacyNames : undefined,
          uploadFileNames: uploadFileNames.length > 0 ? uploadFileNames : undefined,
          candidatesScanned: objects.length,
        });
      }
      continue;
    }

    // Must-have: keep inserts safe when multiple matches exist (insert all distinct).
    const planned: CanonicalFileInsertRow[] = [];
    const plannedKeys = new Set<string>();
    for (const obj of objects) {
      const key = normalizePath(obj.name); // exact key from storage.objects.name
      if (!key) continue;

      const dedupeKey = `${CANONICAL_BUCKET}:${key}`;
      if (existingKeys.has(dedupeKey)) {
        skippedExisting += 1;
        continue;
      }
      if (plannedKeys.has(dedupeKey)) continue;

      const filename = resolveBestFilenameForObject({
        objectKey: key,
        legacyNames: declaredNames.length > 0 ? declaredNames : legacyNames,
      });
      const meta = resolveMimeAndSizeFromObject({
        filename,
        metadata: obj.metadata ?? null,
      });

      planned.push({
        quote_id: quoteId,
        filename,
        bucket_id: CANONICAL_BUCKET,
        storage_path: key,
        mime: meta.mime,
        size_bytes: meta.size_bytes,
        created_at: new Date().toISOString(),
      });
      plannedKeys.add(dedupeKey);
    }

    if (planned.length === 0) {
      missingStorageObjects += 1;
      continue;
    }

    if (args.dryRun) {
      console.log("[backfill] dry-run would insert", {
        quoteId,
        rows: planned.map((r) => ({
          bucket: r.bucket_id,
          path: r.storage_path,
          filename: r.filename,
          mime: r.mime,
          size_bytes: r.size_bytes ?? null,
        })),
      });
      continue;
    }

    const writeResult = await upsertCanonicalRows({ supabase, table: writeTable, rows: planned });
    if (!writeResult.ok) {
      console.error("[backfill] insert failed", {
        quoteId,
        writeTable,
        error: "insert_failed",
      });
      continue;
    }

    insertedRows += planned.length;
    console.log("[backfill] inserted", { quoteId, rows: planned.length, writeTable });
  }

  console.log("[backfill] complete", {
    scannedQuotes,
    eligibleQuotes,
    insertedRows,
    skippedExisting,
    missingStorageObjects,
  });
}

void main();

