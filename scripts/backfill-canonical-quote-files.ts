import { createClient } from "@supabase/supabase-js";

/**
 * Backfill canonical quote file rows for portal previews.
 *
 * Why:
 * - Portal previews ONLY use canonical rows from `files_valid` (fallback `files`).
 * - Legacy `quotes.file_name` / `quotes.file_names` are display-only and must not be used
 *   to guess Storage paths.
 *
 * What this does:
 * - Finds quotes that declare legacy filenames but have no canonical rows.
 * - Resolves the real `storage.objects` entries (preferring `uploads/intake/<auth.uid()>/...`).
 * - Inserts canonical rows referencing the exact bucket + object key.
 *
 * Usage (dry-run first):
 * - `NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfill-canonical-quote-files.ts --dryRun --limit 50`
 * - `NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfill-canonical-quote-files.ts --quoteId <uuid> --dryRun`
 * - Then re-run without `--dryRun` to apply.
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
};

const CANONICAL_BUCKET = "cad_uploads";

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

function basename(path: string): string {
  const normalized = normalizePath(path);
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function normalizeFilenameForMatch(value: string): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_");
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
  // Best-effort: fetch quotes that declare legacy filenames.
  // NOTE: file_names is commonly a jsonb array; "is not null" is enough for coarse filtering.
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
    const p = normalizePath(path);
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
  input: { quoteId: string; authUserId: string | null; upload: UploadRow | null; verbose: boolean },
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

  // 1) Intake uploads (preferred): uploads/intake/<auth.uid()>/...
  if (input.authUserId) {
    const prefix = `uploads/intake/${input.authUserId}/`;
    const { data } = await supabase
      .from("storage.objects")
      .select("bucket_id,name,created_at")
      .eq("bucket_id", CANONICAL_BUCKET)
      .like("name", `${prefix}%`)
      .order("created_at", { ascending: false })
      .limit(1000)
      .returns<StorageObjectRow[]>();
    push(data);
  }

  // 2) Quote-scoped uploads from portals: uploads/quotes/<quoteId>/...
  {
    const prefix = `uploads/quotes/${input.quoteId}/`;
    const { data } = await supabase
      .from("storage.objects")
      .select("bucket_id,name,created_at")
      .eq("bucket_id", CANONICAL_BUCKET)
      .like("name", `${prefix}%`)
      .order("created_at", { ascending: false })
      .limit(500)
      .returns<StorageObjectRow[]>();
    push(data);
  }

  // 3) If uploads.file_path points directly at an object, pull it in.
  const uploadPathRaw = typeof input.upload?.file_path === "string" ? input.upload.file_path.trim() : "";
  if (uploadPathRaw) {
    const normalized = normalizePath(uploadPathRaw);
    const withoutBucket =
      normalized.startsWith(`${CANONICAL_BUCKET}/`) ? normalized.slice(CANONICAL_BUCKET.length + 1) : normalized;
    const namesToTry = Array.from(new Set([normalized, withoutBucket]));
    for (const name of namesToTry) {
      if (!name) continue;
      // Try both "bucket/name" stored formats and "name" stored formats.
      const { data } = await supabase
        .from("storage.objects")
        .select("bucket_id,name,created_at")
        .eq("bucket_id", CANONICAL_BUCKET)
        .eq("name", name)
        .limit(1)
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
        if (baseNorm === target) return 3;
        // Heuristic: intake uploads add prefixes like "<ts>-", "<ts>-<rand>-"
        // so we also match on suffix.
        if (baseNorm.endsWith(`_${target}`) || baseNorm.endsWith(`-${target}`) || baseNorm.endsWith(target)) return 2;
        return 0;
      })(),
      createdMs: entry.obj.created_at ? Date.parse(entry.obj.created_at) : Number.NEGATIVE_INFINITY,
    }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || b.createdMs - a.createdMs);

  return matches[0]?.obj ?? null;
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
  let insertedQuotes = 0;
  let insertedRows = 0;
  let unresolved = 0;

  for (const quote of quotes) {
    if (!quote?.id) continue;
    scanned += 1;

    const quoteId = quote.id;
    const legacyNames = extractLegacyFilenames(quote);
    if (legacyNames.length === 0) continue;

    const existingKeys = await loadExistingCanonicalKeys(supabase, quoteId);
    const existingCount = await loadCanonicalCount(supabase, quoteId);
    if (existingCount === 0) {
      eligible += 1;
    }

    const uploadId = normalizeId(quote.upload_id);
    const upload = uploadId ? await loadUpload(supabase, uploadId) : null;
    const authUserId = await resolveAuthUserIdForQuote(supabase, quote);

    const objects = await loadCandidateObjects(supabase, {
      quoteId,
      authUserId,
      upload,
      verbose: args.verbose,
    });

    const planned: CanonicalFileInsertRow[] = [];
    for (const name of legacyNames) {
      const match = pickBestMatchForFilename(name, objects);
      if (!match) continue;
      const bucket = canonicalizeBucketId(match.bucket_id) || match.bucket_id;
      if (bucket !== CANONICAL_BUCKET) {
        continue;
      }
      const dedupeKey = `${CANONICAL_BUCKET}:${normalizePath(match.name)}`;
      if (existingKeys.has(dedupeKey)) continue;
      planned.push({
        quote_id: quoteId,
        filename: name,
        mime: mimeFromFileName(name),
        storage_path: normalizePath(match.name),
        bucket_id: CANONICAL_BUCKET,
      });
      existingKeys.add(dedupeKey);
    }

    if (planned.length === 0) {
      if (existingCount > 0) {
        if (args.verbose) {
          console.log("[backfill] skip (already has canonical rows)", {
            quoteId,
            existingCount,
          });
        }
        continue;
      }

      unresolved += 1;
      console.warn("[backfill] no storage matches", {
        quoteId,
        uploadId: uploadId || null,
        authUserId,
        legacyFileNames: legacyNames,
        candidatesScanned: objects.length,
      });
      continue;
    }

    if (args.dryRun) {
      console.log("[backfill] dry-run would insert", {
        quoteId,
        rows: planned.map((r) => ({ bucket: r.bucket_id, path: r.storage_path, filename: r.filename })),
      });
      continue;
    }

    const { error } = await supabase.from(writeTable).insert(planned as any);
    if (error) {
      console.error("[backfill] insert failed", {
        quoteId,
        writeTable,
        error: { message: error.message, code: (error as any)?.code ?? null, details: (error as any)?.details ?? null },
      });
      continue;
    }

    insertedQuotes += 1;
    insertedRows += planned.length;
    console.log("[backfill] inserted", { quoteId, rows: planned.length, writeTable });
  }

  console.log("[backfill] complete", {
    scanned,
    eligible,
    insertedQuotes,
    insertedRows,
    unresolved,
  });
}

void main();

