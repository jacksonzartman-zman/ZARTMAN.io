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
 *   - `uploads/intake/<uid>/**/<ts>-<filename>`
 *   - `uploads/<ts>-<rand>-<filename>`
 *   - `uploads/<quoteId>/**`
 *   - `uploads/quotes/<quoteId>/**`
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
  bucket_id: string;
  name: string;
  created_at: string | null;
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
  // Best-effort: fetch quotes that might need backfill.
  // NOTE: file_names is commonly a jsonb array; "is not null" is enough for coarse filtering.
  // We include upload-linked quotes too, since some historical quotes were created
  // without legacy filename fields but do have uploads/storage objects.
  const { data, error } = await supabase
    .from("quotes")
    .select("id,upload_id,customer_id,customer_email,file_name,file_names,created_at")
    .or("upload_id.not.is.null,file_name.not.is.null,file_names.not.is.null")
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<QuoteRow[]>();
  if (error || !Array.isArray(data)) return [];
  return data;
}

async function loadCanonicalCount(
  supabase: ReturnType<typeof createClient>,
  quoteId: string,
): Promise<number> {
  const countFrom = async (table: "files_valid" | "files") => {
    try {
      const { count, error } = await supabase
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("quote_id", quoteId);
      if (error) return null;
      return typeof count === "number" ? count : null;
    } catch {
      return null;
    }
  };

  const valid = await countFrom("files_valid");
  if (typeof valid === "number") return valid;
  const files = await countFrom("files");
  if (typeof files === "number") return files;
  return 0;
}

async function loadExistingCanonicalKeys(
  supabase: ReturnType<typeof createClient>,
  quoteId: string,
): Promise<Set<string>> {
  const keys = new Set<string>();
  const add = (bucket: string, path: string) => {
    const b = canonicalizeBucketId(bucket) || bucket;
    const p = normalizeStorageObjectKey(b, path);
    if (!b || !p) return;
    keys.add(`${b}:${p}`);
  };

  const tryLoad = async (table: "files_valid" | "files") => {
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
      if (error) return;
      for (const row of data ?? []) {
        const bucket =
          (typeof row.storage_bucket_id === "string" && row.storage_bucket_id) ||
          (typeof row.bucket_id === "string" && row.bucket_id) ||
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
  };

  await tryLoad("files_valid");
  await tryLoad("files");
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
      const bucket = canonicalizeBucketId(row.bucket_id) || row.bucket_id;
      const name = normalizePath(row.name);
      if (!bucket || !name) continue;
      const key = `${bucket}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ ...row, bucket_id: bucket, name });
    }
  };

  const storageObjects = storageObjectsQuery(supabase);
  if (!storageObjects) {
    if (input.verbose) {
      console.warn("[backfill] storage schema client unavailable; cannot query storage.objects via PostgREST");
    }
    return candidates;
  }

  const quotePrefixes = [
    `uploads/quotes/${input.quoteId}/`,
    `uploads/${input.quoteId}/`,
    `quote_uploads/${input.quoteId}/`,
    `quotes/${input.quoteId}/`,
  ];

  const intakePrefix = input.authUserId ? `uploads/intake/${input.authUserId}/` : null;

  for (const bucketId of SEARCH_BUCKETS) {
    // 1) Intake uploads (preferred): uploads/intake/<auth.uid()>/...
    if (intakePrefix) {
      const { data } = await storageObjects
        .select("bucket_id,name,created_at")
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
        .select("bucket_id,name,created_at")
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
          .select("bucket_id,name,created_at")
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
        .select("bucket_id,name,created_at")
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

function pickBestMatchForFilename(
  filename: string,
  objects: StorageObjectRow[],
): StorageObjectRow | null {
  const target = normalizeFilenameForMatch(filename);
  if (!target) return null;

  const matches = objects
    .map((obj) => ({ obj, base: basename(obj.name) }))
    .map((entry) => ({
      obj: entry.obj,
      base: entry.base,
      score: (() => {
        const baseNorm = normalizeFilenameForMatch(entry.base);
        const strippedNorm = normalizeFilenameForMatch(stripTimestampPrefixes(entry.base));
        if (baseNorm === target) return 3;
        if (strippedNorm === target) return 3;
        // Heuristic: intake uploads add prefixes like "<ts>-", "<ts>-<rand>-"
        // so we also match on suffix.
        if (baseNorm.endsWith(`-${target}`) || baseNorm.endsWith(target)) return 2;
        if (strippedNorm.endsWith(`-${target}`) || strippedNorm.endsWith(target)) return 2;
        return 0;
      })(),
      createdMs: entry.obj.created_at ? Date.parse(entry.obj.created_at) : Number.NEGATIVE_INFINITY,
    }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || b.createdMs - a.createdMs);

  return matches[0]?.obj ?? null;
}

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
      created_at: r.created_at ?? null,
    }),
    // Alternate bucket column.
    (r: CanonicalFileInsertRow) => ({
      quote_id: r.quote_id,
      filename: r.filename,
      mime: r.mime,
      storage_bucket_id: r.bucket_id,
      storage_path: r.storage_path,
      created_at: r.created_at ?? null,
    }),
    // Alternate path column.
    (r: CanonicalFileInsertRow) => ({
      quote_id: r.quote_id,
      filename: r.filename,
      mime: r.mime,
      bucket_id: r.bucket_id,
      file_path: r.storage_path,
      created_at: r.created_at ?? null,
    }),
    // Both alternates.
    (r: CanonicalFileInsertRow) => ({
      quote_id: r.quote_id,
      filename: r.filename,
      mime: r.mime,
      storage_bucket_id: r.bucket_id,
      file_path: r.storage_path,
      created_at: r.created_at ?? null,
    }),
  ] as const;

  // Attempt upsert if a unique index exists; fallback to insert.
  // If schema doesn't support the chosen columns, try the next variant.
  for (const mapper of variants) {
    const payload = rows.map(mapper);
    try {
      const upsertAttempt = await supabase
        .from(table)
        .upsert(payload as any, { onConflict: "quote_id,bucket_id,storage_path" });
      if (!upsertAttempt.error) return { ok: true, inserted: rows.length };
    } catch {
      // ignore and fall through
    }

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
      "Missing env. Required: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
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

  let scanned = 0;
  let eligible = 0;
  let fixedQuotes = 0;
  let insertedRows = 0;
  let skippedAlreadyCanonical = 0;
  let skippedNoMatches = 0;
  let skippedNoHints = 0;

  for (const quote of quotes) {
    if (!quote?.id) continue;
    scanned += 1;

    const quoteId = quote.id;
    const legacyNames = extractLegacyFilenames(quote);

    const existingKeys = await loadExistingCanonicalKeys(supabase, quoteId);
    const existingCount = await loadCanonicalCount(supabase, quoteId);
    if (existingCount !== 0) {
      skippedAlreadyCanonical += 1;
      if (args.verbose) {
        console.log("[backfill] skip (already has canonical rows)", { quoteId, existingCount });
      }
      continue;
    }
    eligible += 1;

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

    const planned: CanonicalFileInsertRow[] = [];
    if (declaredNames.length > 0) {
      for (const name of declaredNames) {
        const match = pickBestMatchForFilename(name, objects);
        if (!match) continue;
        const key = normalizeStorageObjectKey(match.bucket_id, match.name);
        const dedupeKey = `${CANONICAL_BUCKET}:${key}`;
        if (existingKeys.has(dedupeKey)) continue;
        planned.push({
          quote_id: quoteId,
          filename: name,
          mime: mimeFromFileName(name),
          storage_path: key,
          bucket_id: CANONICAL_BUCKET,
          created_at: new Date().toISOString(),
        });
        existingKeys.add(dedupeKey);
      }
    } else if (objects.length > 0) {
      // Fallback: if we can find a single unambiguous storage object but no declared filenames,
      // backfill using the storage object's basename.
      // This avoids leaving "upload-only" quotes permanently empty in portals.
      const sorted = [...objects].sort((a, b) => {
        const am = a.created_at ? Date.parse(a.created_at) : Number.NEGATIVE_INFINITY;
        const bm = b.created_at ? Date.parse(b.created_at) : Number.NEGATIVE_INFINITY;
        return bm - am;
      });
      const first = sorted[0] ?? null;
      if (first) {
        const key = normalizeStorageObjectKey(first.bucket_id, first.name);
        const dedupeKey = `${CANONICAL_BUCKET}:${key}`;
        if (key && !existingKeys.has(dedupeKey)) {
          const inferredName = basename(key);
          planned.push({
            quote_id: quoteId,
            filename: inferredName,
            mime: mimeFromFileName(inferredName),
            storage_path: key,
            bucket_id: CANONICAL_BUCKET,
            created_at: new Date().toISOString(),
          });
          existingKeys.add(dedupeKey);
        }
      }
    }

    if (planned.length === 0) {
      if (declaredNames.length === 0) {
        skippedNoHints += 1;
      } else {
        skippedNoMatches += 1;
      }
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

    if (args.dryRun) {
      console.log("[backfill] dry-run would insert", {
        quoteId,
        rows: planned.map((r) => ({ bucket: r.bucket_id, path: r.storage_path, filename: r.filename })),
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

    fixedQuotes += 1;
    insertedRows += planned.length;
    console.log("[backfill] inserted", { quoteId, rows: planned.length, writeTable });
  }

  console.log("[backfill] complete", {
    scanned,
    eligible,
    insertedRows,
    fixedQuotes,
    skippedAlreadyCanonical,
    skippedNoMatches,
    skippedNoHints,
  });
}

void main();

