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
<<<<<<< HEAD
    `[backfill] cannot read files tables: files_valid=${JSON.stringify(r1.error)} files=${JSON.stringify(r2.error)}`,
=======
    `[backfill] cannot read files tables: files_valid=${JSON.stringify(r1.error)} files=${JSON.stringify(r2.error)}`
>>>>>>> a5e23f0 (backfill)
  );
}

async function detectPathCol(supabase: SupabaseClient, table: CanonicalTable): Promise<PathCol> {
  const r1 = await supabase.from(table).select("id,quote_id,bucket_id,storage_path").limit(1);
  if (!r1.error) return "storage_path";
  const r2 = await supabase.from(table).select("id,quote_id,bucket_id,file_path").limit(1);
  if (!r2.error) return "file_path";
  throw new Error(
<<<<<<< HEAD
    `[backfill] cannot determine path column: storage_path=${JSON.stringify(r1.error)} file_path=${JSON.stringify(r2.error)}`,
=======
    `[backfill] cannot determine path column: storage_path=${JSON.stringify(r1.error)} file_path=${JSON.stringify(r2.error)}`
>>>>>>> a5e23f0 (backfill)
  );
}

async function loadCandidateQuotes(supabase: SupabaseClient, quoteId: string | undefined, limit: number) {
  let q = supabase.from("quotes").select("id,upload_id").not("upload_id", "is", null).limit(limit);
  if (quoteId) q = q.eq("id", quoteId);
  const res = await q;
  if (res.error) throw new Error(`[backfill] load quotes failed: ${JSON.stringify(toPlainError(res.error))}`);
  return (res.data ?? []) as Array<{ id: string; upload_id: string }>;
}

<<<<<<< HEAD
=======
type UploadRow = {
  id: string;
  quote_id: string | null;
  file_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  created_at: string | null;
};

>>>>>>> a5e23f0 (backfill)
async function loadUploadRow(supabase: SupabaseClient, uploadId: string) {
  const res = await supabase
    .from("uploads")
    .select("id,quote_id,file_path,file_name,mime_type,created_at")
    .eq("id", uploadId)
    .maybeSingle();
  if (res.error) throw new Error(`[backfill] load upload failed: ${JSON.stringify(toPlainError(res.error))}`);
<<<<<<< HEAD
  return (res.data ?? null) as
    | null
    | {
        id: string;
        quote_id: string | null;
        file_path: string | null;
        file_name: string | null;
        mime_type: string | null;
        created_at: string | null;
      };
=======
  return (res.data ?? null) as UploadRow | null;
>>>>>>> a5e23f0 (backfill)
}

function basename(p: string | null): string | null {
  if (!p) return null;
  const b = path.posix.basename(p);
  return b || null;
}

function deriveMime(filename: string | null, fallback: string | null): string {
  const hinted = (fallback ?? "").trim();
  if (hinted) return hinted;
<<<<<<< HEAD
  const ext = (filename ?? "").toLowerCase();
  if (ext.endsWith(".step") || ext.endsWith(".stp")) return "model/step";
  if (ext.endsWith(".stl")) return "model/stl";
  if (ext.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

async function findStorageObjectKey(params: {
  supabase: SupabaseClient;
  uploadId: string;
  uploadFilePath: string | null;
  verbose: boolean;
}) {
  const { supabase, uploadId, uploadFilePath, verbose } = params;

  // We expect actual keys to look like: uploads/intake/<upload_id>/<token>/<timestamp>-<filename>
  const intakePrefix = `uploads/intake/${uploadId}/`;
  const fileBase = basename(uploadFilePath);

  // 1) exact match on uploadFilePath (rare but cheap)
  if (uploadFilePath) {
    const exact = await supabase
      .schema("storage")
      .from("objects")
      .select("name,bucket_id,created_at")
      .eq("bucket_id", "cad_uploads")
      .eq("name", uploadFilePath)
      .limit(1);
    if (exact.error) throw new Error(`[backfill] storage exact lookup failed: ${JSON.stringify(toPlainError(exact.error))}`);
    if ((exact.data ?? []).length > 0) return exact.data![0]!.name as string;
  }

  // 2) strict intake-prefix match
  const pref = await supabase
    .schema("storage")
    .from("objects")
    .select("name,bucket_id,created_at")
    .eq("bucket_id", "cad_uploads")
    .like("name", `${intakePrefix}%`)
    .order("created_at", { ascending: false })
    .limit(25);
  if (pref.error) throw new Error(`[backfill] storage prefix lookup failed: ${JSON.stringify(toPlainError(pref.error))}`);

  if (fileBase) {
    const match = (pref.data ?? []).find((r: any) => String(r.name).toLowerCase().includes(fileBase.toLowerCase()));
    if (match) return match.name as string;
  }
  if ((pref.data ?? []).length > 0) {
    // If we have objects under the prefix but can't match basename, just take the newest
    return pref.data![0]!.name as string;
  }

  // 3) fallback: filename ilike, but constrain to intake prefix (so we don’t grab some other quote’s file)
  if (fileBase) {
    const fb = await supabase
      .schema("storage")
      .from("objects")
      .select("name,bucket_id,created_at")
      .eq("bucket_id", "cad_uploads")
      .ilike("name", `%${fileBase}%`)
      .ilike("name", `${intakePrefix}%`)
      .order("created_at", { ascending: false })
      .limit(1);
    if (fb.error) throw new Error(`[backfill] storage ilike lookup failed: ${JSON.stringify(toPlainError(fb.error))}`);
    if ((fb.data ?? []).length > 0) return fb.data![0]!.name as string;
  }

  maybeLog(verbose, "[backfill] no storage object found", { uploadId, uploadFilePath, intakePrefix, fileBase });
  return null;
=======
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

async function findStorageObjectKeyViaStorageApi(params: {
  supabase: SupabaseClient;
  uploadId: string;
  uploadFilePath: string | null;
  verbose: boolean;
}): Promise<string | null> {
  const { supabase, uploadId, uploadFilePath, verbose } = params;

  const bucketId = "cad_uploads";
  const intakePrefix = `uploads/intake/${uploadId}`;

  // Supabase Storage list() wants a path WITHOUT a trailing slash.
  const res = await supabase.storage.from(bucketId).list(intakePrefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });

  if (res.error) {
    throw new Error(`[backfill] storage list failed: ${JSON.stringify(toPlainError(res.error))}`);
  }

  const items = (res.data ?? []) as StorageListItem[];
  if (items.length === 0) {
    maybeLog(verbose, "[backfill] storage list empty", { bucketId, intakePrefix });
    return null;
  }

  const chosen = pickBestObjectKey(items, uploadFilePath);
  if (!chosen) return null;

  // list() returns names relative to the folder you listed.
  // We must store full object key in files_valid/files.
  const fullKey = `${intakePrefix}/${chosen}`.replace(/\/+/g, "/");
  return fullKey;
>>>>>>> a5e23f0 (backfill)
}

async function loadExistingKeys(params: {
  supabase: SupabaseClient;
  table: CanonicalTable;
  pathCol: PathCol;
  quoteId: string;
}) {
  const { supabase, table, pathCol, quoteId } = params;
<<<<<<< HEAD
  const sel = pathCol === "storage_path" ? "id,quote_id,bucket_id,storage_path" : "id,quote_id,bucket_id,file_path";
=======
  const sel =
    pathCol === "storage_path"
      ? "id,quote_id,bucket_id,storage_path"
      : "id,quote_id,bucket_id,file_path";
>>>>>>> a5e23f0 (backfill)
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

    for (const q of quotes) {
      const upload = await loadUploadRow(supabase, q.upload_id);
      if (!upload) continue;

      summary.eligibleQuotes += 1;

<<<<<<< HEAD
      const chosenKey = await findStorageObjectKey({
=======
      const chosenKey = await findStorageObjectKeyViaStorageApi({
>>>>>>> a5e23f0 (backfill)
        supabase,
        uploadId: q.upload_id,
        uploadFilePath: upload.file_path,
        verbose: args.verbose,
      });

      if (!chosenKey) {
        summary.missingStorageObjects += 1;
        if (args.verbose) {
          summary.perQuote!.push({
            quoteId: q.id,
            uploadId: q.upload_id,
            uploadFilePath: upload.file_path,
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
            chosenObjectKey: chosenKey,
            plannedInserts: 0,
            skippedExisting: 1,
          });
        }
        continue;
      }

      const filename = basename(chosenKey) ?? chosenKey;
      const mime = deriveMime(filename, upload.mime_type);

      if (!args.dryRun) {
        await insertCanonical({ supabase, table, pathCol, quoteId: q.id, key: chosenKey, filename, mime });
      }
<<<<<<< HEAD
=======

>>>>>>> a5e23f0 (backfill)
      summary.insertedRows += 1;

      if (args.verbose) {
        summary.perQuote!.push({
          quoteId: q.id,
          uploadId: q.upload_id,
          uploadFilePath: upload.file_path,
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
<<<<<<< HEAD

=======
>>>>>>> a5e23f0 (backfill)
