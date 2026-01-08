import { createClient, SupabaseClient } from "@supabase/supabase-js";
import path from "path";

type CanonicalTable = "files_valid" | "files";
type PathCol = "storage_path" | "file_path";

type CliArgs = {
  dryRun: boolean;
  limit: number;
  verbose: boolean;
  quoteId?: string;
};

type Summary = {
  canonicalTableUsed: CanonicalTable | null;
  pathColUsed: PathCol | null;
  scannedQuotes: number;
  eligibleQuotes: number;
  insertedRows: number;
  skippedExisting: number;
  missingStorageObjects: number;
  perQuote?: Array<{
    quoteId: string;
    uploadId: string;
    uploadFilePath: string | null;
    uploadFileName: string | null;
    chosenObjectKey: string | null;
    plannedInserts: number;
    skippedExisting: number;
  }>;
};

function parseArgs(argv: string[]): CliArgs {
  const args = new Set(argv);
  const get = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    dryRun: args.has("--dryRun"),
    verbose: args.has("--verbose"),
    limit: Number(get("--limit") ?? "200"),
    quoteId: get("--quoteId"),
  };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[backfill] missing env: ${name}`);
  return v;
}

function maybeLog(verbose: boolean, ...parts: any[]) {
  if (verbose) console.log(...parts);
}

// Computes a "logical filename" for an upload without requiring
// any optional/legacy name columns to exist in the uploads schema.
function computeUploadLogicalFilename(upload: Record<string, any> | null | undefined): string | null {
  if (!upload) return null;

  // Prefer any present name-ish field (but do NOT rely on selecting them).
  for (const k of ["filename", "file_name", "original_name", "name"]) {
    const v = upload[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }

  // Always fall back to the basename of file_path.
  const fp = upload["file_path"];
  if (typeof fp !== "string" || !fp.trim()) return null;
  const base = fp.split("/").filter(Boolean).pop() ?? "";
  return base.trim() || null;
}

function toPlainError(e: unknown) {
  if (!e || typeof e !== "object") return { message: String(e) };
  const obj: any = e;
  const out: any = {};
  for (const k of Object.keys(obj)) out[k] = obj[k];
  for (const k of ["message", "details", "hint", "code", "status", "name", "stack"]) {
    if (typeof obj[k] === "string" || typeof obj[k] === "number") out[k] = obj[k];
  }
  return out;
}

async function detectCanonicalTable(supabase: SupabaseClient): Promise<CanonicalTable> {
  const r1 = await supabase.from("files_valid").select("id").limit(1);
  if (!r1.error) return "files_valid";
  const r2 = await supabase.from("files").select("id").limit(1);
  if (!r2.error) return "files";
  throw new Error(
    `[backfill] cannot read files tables: files_valid=${JSON.stringify(r1.error)} files=${JSON.stringify(r2.error)}`
  );
}

async function detectPathCol(supabase: SupabaseClient, table: CanonicalTable): Promise<PathCol> {
  const r1 = await supabase.from(table).select("id,quote_id,bucket_id,storage_path").limit(1);
  if (!r1.error) return "storage_path";
  const r2 = await supabase.from(table).select("id,quote_id,bucket_id,file_path").limit(1);
  if (!r2.error) return "file_path";
  throw new Error(
    `[backfill] cannot determine path column: storage_path=${JSON.stringify(r1.error)} file_path=${JSON.stringify(r2.error)}`
  );
}

async function loadCandidateQuotes(supabase: SupabaseClient, quoteId: string | undefined, limit: number) {
  let q = supabase
    .from("quotes")
    .select("id,upload_id,customer_id")
    .not("upload_id", "is", null)
    .limit(limit);
  if (quoteId) q = q.eq("id", quoteId);
  const res = await q;
  if (res.error) throw new Error(`[backfill] load quotes failed: ${JSON.stringify(toPlainError(res.error))}`);
  return (res.data ?? []) as Array<{ id: string; upload_id: string; customer_id: string | null }>;
}

type UploadRow = {
  id: string;
  quote_id: string | null;
  file_path: string | null;
  created_at: string | null;
};

async function loadUploadRow(supabase: SupabaseClient, uploadId: string) {
  const res = await supabase
    .from("uploads")
    // Intentionally select only columns that are safe across schemas.
    // Do NOT select uploads.filename (often does not exist).
    .select("id,quote_id,file_path,created_at")
    .eq("id", uploadId)
    .maybeSingle();
  if (res.error) throw new Error(`[backfill] load upload failed: ${JSON.stringify(toPlainError(res.error))}`);
  return (res.data ?? null) as UploadRow | null;
}

function basename(p: string | null): string | null {
  if (!p) return null;
  const b = path.posix.basename(p);
  return b || null;
}

function deriveMime(filename: string | null, fallback: string | null): string {
  const hinted = (fallback ?? "").trim();
  if (hinted) return hinted;
  const lower = (filename ?? "").toLowerCase();
  if (lower.endsWith(".step") || lower.endsWith(".stp")) return "model/step";
  if (lower.endsWith(".stl")) return "model/stl";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

type StorageListItem = {
  name: string;
  id?: string;
  updated_at?: string;
  created_at?: string;
  metadata?: any;
};

function pickBestObjectKey(items: StorageListItem[], uploadFilePath: string | null): string | null {
  if (!items || items.length === 0) return null;

  const targetBase = (basename(uploadFilePath) ?? "").toLowerCase();

  // Prefer exact basename containment (handles timestamp prefixes).
  if (targetBase) {
    const exactish = items.find((it) => String(it.name).toLowerCase().includes(targetBase));
    if (exactish) return exactish.name;
  }

  // Otherwise pick the newest by updated_at/created_at if present; else first.
  const scored = [...items].sort((a, b) => {
    const ta = Date.parse(String(a.updated_at ?? a.created_at ?? "")) || 0;
    const tb = Date.parse(String(b.updated_at ?? b.created_at ?? "")) || 0;
    return tb - ta;
  });

  return scored[0]?.name ?? null;
}

function normalizeKey(k: string): string {
  return k.replace(/^\/+/, "").replace(/\/+/g, "/");
}

function uniqStrings(xs: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    if (typeof x !== "string") continue;
    const v = x.trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function pickBestFullKey(fullKeys: string[], preferredBasenames: string[]): string | null {
  if (fullKeys.length === 0) return null;
  const lowers = fullKeys.map((k) => ({ k, base: (basename(k) ?? "").toLowerCase() }));

  // Prefer exact basename match (case-insensitive), in the order we were given.
  for (const b of preferredBasenames) {
    const needle = b.toLowerCase();
    const exact = lowers.find((x) => x.base === needle);
    if (exact) return exact.k;
  }

  // Otherwise, allow basename containment (handles timestamp prefixes).
  for (const b of preferredBasenames) {
    const needle = b.toLowerCase();
    if (!needle) continue;
    const contains = lowers.find((x) => x.base.includes(needle));
    if (contains) return contains.k;
  }

  // Otherwise, pick first (stable).
  return fullKeys[0] ?? null;
}

async function listUnderPrefix(params: {
  supabase: SupabaseClient;
  bucketId: string;
  prefix: string; // WITHOUT trailing slash
}): Promise<StorageListItem[]> {
  const { supabase, bucketId, prefix } = params;
  const res = await supabase.storage
    .from(bucketId)
    .list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
  if (res.error) {
    throw new Error(`[backfill] storage list failed: ${JSON.stringify(toPlainError(res.error))}`);
  }
  return (res.data ?? []) as StorageListItem[];
}

async function findStorageObjectKeyViaStorageApiLegacy(params: {
  supabase: SupabaseClient;
  uploadFilePath: string | null;
  uploadFileName: string | null;
  intakeRoots: string[];
  verbose: boolean;
}): Promise<string | null> {
  const { supabase, uploadFilePath, uploadFileName, intakeRoots, verbose } = params;

  const bucketId = "cad_uploads";

  const preferredBasenames = uniqStrings([basename(uploadFilePath), uploadFileName]);
  if (preferredBasenames.length === 0) return null;

  for (const intakeRoot of intakeRoots) {
    // Supabase Storage list() wants a path WITHOUT a trailing slash.
    const rootPrefix = normalizeKey(`uploads/intake/${intakeRoot}`);
    const rootItems = await listUnderPrefix({ supabase, bucketId, prefix: rootPrefix });

    if (rootItems.length === 0) {
      maybeLog(verbose, "[backfill] storage list empty", { bucketId, intakePrefix: `${rootPrefix}/` });
      continue;
    }

    // Common shape is: uploads/intake/<userId>/<sessionId>/<filename>
    // list() is not recursive, so we expand one additional level when we see session-like folders.
    const fullKeys: string[] = [];
    for (const it of rootItems) {
      const childName = String(it.name ?? "").trim();
      if (!childName) continue;

      // If it looks like a file directly under root, include it.
      if (childName.includes(".")) {
        fullKeys.push(normalizeKey(`${rootPrefix}/${childName}`));
        continue;
      }

      // Otherwise treat as a folder/prefix and list inside it.
      const childPrefix = normalizeKey(`${rootPrefix}/${childName}`);
      const childItems = await listUnderPrefix({ supabase, bucketId, prefix: childPrefix });
      for (const ci of childItems) {
        const leaf = String(ci.name ?? "").trim();
        if (!leaf) continue;
        fullKeys.push(normalizeKey(`${childPrefix}/${leaf}`));
      }
    }

    const chosenFullKey = pickBestFullKey(fullKeys, preferredBasenames);
    if (chosenFullKey) return chosenFullKey;
  }

  return null;
}

async function loadExistingKeys(params: {
  supabase: SupabaseClient;
  table: CanonicalTable;
  pathCol: PathCol;
  quoteId: string;
}) {
  const { supabase, table, pathCol, quoteId } = params;
  const sel =
    pathCol === "storage_path"
      ? "id,quote_id,bucket_id,storage_path"
      : "id,quote_id,bucket_id,file_path";
  const res = await supabase.from(table).select(sel).eq("quote_id", quoteId).limit(5000);
  if (res.error) throw new Error(`[backfill] load existing canonical rows failed: ${JSON.stringify(toPlainError(res.error))}`);
  const rows = (res.data ?? []) as any[];
  return new Set(rows.map((r) => `cad_uploads::${String(pathCol === "storage_path" ? r.storage_path : r.file_path)}`));
}

async function insertCanonical(params: {
  supabase: SupabaseClient;
  table: CanonicalTable;
  pathCol: PathCol;
  quoteId: string;
  key: string;
  filename: string;
  mime: string;
}) {
  const { supabase, table, pathCol, quoteId, key, filename, mime } = params;
  const payload =
    pathCol === "storage_path"
      ? { quote_id: quoteId, bucket_id: "cad_uploads", storage_path: key, filename, mime }
      : { quote_id: quoteId, bucket_id: "cad_uploads", file_path: key, filename, mime };

  const res = await supabase.from(table).insert(payload);
  if (res.error) throw new Error(`[backfill] insert canonical failed: ${JSON.stringify(toPlainError(res.error))}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const summary: Summary = {
    canonicalTableUsed: null,
    pathColUsed: null,
    scannedQuotes: 0,
    eligibleQuotes: 0,
    insertedRows: 0,
    skippedExisting: 0,
    missingStorageObjects: 0,
    perQuote: args.verbose ? [] : undefined,
  };

  try {
    const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const table = await detectCanonicalTable(supabase);
    summary.canonicalTableUsed = table;

    const pathCol = await detectPathCol(supabase, table);
    summary.pathColUsed = pathCol;

    const quotes = await loadCandidateQuotes(supabase, args.quoteId, args.limit);
    summary.scannedQuotes = quotes.length;

    let verbosePrintedComputedName = 0;
    const customerUserIdCache = new Map<string, string | null>();

    const loadCustomerUserId = async (customerId: string | null): Promise<string | null> => {
      if (!customerId) return null;
      if (customerUserIdCache.has(customerId)) return customerUserIdCache.get(customerId) ?? null;
      const res = await supabase.from("customers").select("user_id").eq("id", customerId).maybeSingle();
      if (res.error) {
        maybeLog(args.verbose, "[backfill] load customer user_id failed", {
          customerId,
          error: toPlainError(res.error),
        });
        customerUserIdCache.set(customerId, null);
        return null;
      }
      const v = (res.data as any)?.user_id;
      const userId = typeof v === "string" && v.trim() ? v.trim() : null;
      customerUserIdCache.set(customerId, userId);
      return userId;
    };

    for (const q of quotes) {
      const upload = await loadUploadRow(supabase, q.upload_id);
      if (!upload) continue;

      summary.eligibleQuotes += 1;

      const uploadFileName = computeUploadLogicalFilename(upload);
      if (args.verbose && verbosePrintedComputedName < 2) {
        verbosePrintedComputedName += 1;
        maybeLog(args.verbose, "[backfill] computed upload logical filename", {
          uploadId: q.upload_id,
          file_path: upload.file_path,
          uploadFileName,
        });
      }

      const uploadFilePath =
        typeof upload.file_path === "string" && upload.file_path.trim() ? upload.file_path.trim() : null;

      // 1) Fast-path: uploads.file_path already contains the real storage key.
      // If it points to intake, trust it and DO NOT hit storage.list().
      let chosenKey: string | null = null;
      if (uploadFilePath && uploadFilePath.startsWith("uploads/intake/")) {
        chosenKey = normalizeKey(uploadFilePath);
      } else {
        // 2) Legacy fallback: scan storage under possible intake roots and match by basename.
        const customerUserId = await loadCustomerUserId(q.customer_id);
        const intakeRoots = uniqStrings([customerUserId]);
        chosenKey = await findStorageObjectKeyViaStorageApiLegacy({
          supabase,
          uploadFilePath,
          uploadFileName,
          intakeRoots,
          verbose: args.verbose,
        });
      }

      if (!chosenKey) {
        summary.missingStorageObjects += 1;
        if (args.verbose) {
          summary.perQuote!.push({
            quoteId: q.id,
            uploadId: q.upload_id,
            uploadFilePath: upload.file_path,
            uploadFileName,
            chosenObjectKey: null,
            plannedInserts: 0,
            skippedExisting: 0,
          });
        }
        continue;
      }

      const existing = await loadExistingKeys({ supabase, table, pathCol, quoteId: q.id });
      const existingKey = `cad_uploads::${chosenKey}`;

      if (existing.has(existingKey)) {
        summary.skippedExisting += 1;
        if (args.verbose) {
          summary.perQuote!.push({
            quoteId: q.id,
            uploadId: q.upload_id,
            uploadFilePath: upload.file_path,
            uploadFileName,
            chosenObjectKey: chosenKey,
            plannedInserts: 0,
            skippedExisting: 1,
          });
        }
        continue;
      }

      const filename = basename(chosenKey) ?? chosenKey;
      const mime = deriveMime(filename, null);

      if (!args.dryRun) {
        await insertCanonical({ supabase, table, pathCol, quoteId: q.id, key: chosenKey, filename, mime });
      }
      summary.insertedRows += 1;

      if (args.verbose) {
        summary.perQuote!.push({
          quoteId: q.id,
          uploadId: q.upload_id,
          uploadFilePath: upload.file_path,
          uploadFileName,
          chosenObjectKey: chosenKey,
          plannedInserts: 1,
          skippedExisting: 0,
        });
      }
    }
  } catch (e) {
    console.error("[backfill] fatal", JSON.stringify(toPlainError(e)));
    throw e;
  } finally {
    console.log(JSON.stringify(summary));
  }
}

main().catch(() => process.exit(1));
