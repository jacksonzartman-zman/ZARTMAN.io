// Supabase Edge Function: parts-file-descriptors
//
// Centralizes heavy ZIP/PDF processing for AI parts suggestions.
//
// Env:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY (preferred) or SUPABASE_ANON_KEY
//
// Request:
//   { "quoteId": string }
//
// Response:
//   { quoteId: string, files: EdgeFileDescriptor[], error?: string }

import { createClient } from "jsr:@supabase/supabase-js@2";
import JSZip from "npm:jszip@3.10.1";

type EdgeFileDescriptor = {
  id: string;
  fileName: string;
  path: string;
  mimeType: string | null;
  classification: "CAD" | "Drawing" | "Other";
  sampleText?: string;
};

type EdgeFileDescriptorResponse = {
  quoteId: string;
  files: EdgeFileDescriptor[];
  error?: string;
};

type QuoteUploadFileRow = {
  id: string;
  upload_id: string;
  path: string;
  filename: string;
  extension: string | null;
  is_from_archive: boolean;
  size_bytes: number | null;
};

type UploadRow = {
  id: string;
  file_path: string | null;
  file_name: string | null;
  mime_type: string | null;
};

type FilesRow = {
  filename: string;
  storage_path: string;
  bucket_id: string | null;
  mime: string | null;
};

const MAX_PDF_SAMPLE_CHARS = 3500;

const CAD_EXTENSIONS = new Set([
  "step",
  "stp",
  "iges",
  "igs",
  "stl",
  "sldprt",
  "sldasm",
  "x_t",
  "x_b",
  "xmt_txt",
  "xmt_bin",
  "prt",
  "asm",
]);

const DRAWING_EXTENSIONS = new Set(["pdf", "dwg", "dxf"]);

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeExtension(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.startsWith(".") ? trimmed.slice(1) : trimmed;
}

function classifyUploadFileType(input: {
  filename?: string | null;
  extension?: string | null;
}): "cad" | "drawing" | "other" {
  const ext =
    normalizeExtension(input.extension) ??
    normalizeExtension(extractExtensionFromName(input.filename));

  if (!ext) return "other";
  if (CAD_EXTENSIONS.has(ext)) return "cad";
  if (DRAWING_EXTENSIONS.has(ext)) return "drawing";
  return "other";
}

function extractExtensionFromName(fileName?: string | null): string | null {
  if (typeof fileName !== "string") return null;
  const trimmed = fileName.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(".");
  if (parts.length < 2) return null;
  return parts[parts.length - 1] ?? null;
}

function toDescriptorClassification(kind: ReturnType<typeof classifyUploadFileType>):
  | "CAD"
  | "Drawing"
  | "Other" {
  if (kind === "cad") return "CAD";
  if (kind === "drawing") return "Drawing";
  return "Other";
}

function parseStoragePath(storagePath: string): { bucket: string; key: string } | null {
  const trimmed = storagePath.trim().replace(/^\/+/, "");
  if (!trimmed) return null;
  const idx = trimmed.indexOf("/");
  if (idx <= 0) return null;
  const bucket = trimmed.slice(0, idx).trim();
  const key = trimmed.slice(idx + 1).trim();
  if (!bucket || !key) return null;
  return { bucket, key };
}

function guessMimeTypeFromExtension(ext: string | null): string | null {
  const e = (ext ?? "").trim().toLowerCase();
  if (!e) return null;
  if (e === "pdf") return "application/pdf";
  if (e === "zip") return "application/zip";
  if (e === "dwg") return "application/acad";
  if (e === "dxf") return "application/dxf";
  if (e === "step" || e === "stp") return "application/step";
  if (e === "iges" || e === "igs") return "model/iges";
  if (e === "stl") return "model/stl";
  return null;
}

async function extractPdfFirstPageText(pdfBytes: Uint8Array, maxChars: number): Promise<string> {
  const pdfjs = await import("npm:pdfjs-dist@4.10.38/legacy/build/pdf.mjs");

  // Ensure we don't try to spawn a worker in the edge runtime.
  try {
    (pdfjs as any).GlobalWorkerOptions.workerSrc = "";
  } catch {
    // ignore
  }

  const doc = await (pdfjs as any).getDocument({ data: pdfBytes, disableWorker: true }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  const items = Array.isArray(content?.items) ? content.items : [];
  const raw = items
    .map((it: any) => (typeof it?.str === "string" ? it.str : ""))
    .filter(Boolean)
    .join(" ");
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.slice(0, Math.max(0, maxChars));
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }

  let quoteId = "";

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    if (!supabaseUrl) {
      throw new Error("missing_SUPABASE_URL");
    }

    // If a service role key is configured, require it as a bearer token to prevent
    // this endpoint from becoming a public quote-file enumerator.
    if (serviceRoleKey) {
      const auth = req.headers.get("authorization") ?? "";
      if (auth !== `Bearer ${serviceRoleKey}`) {
        const resp: EdgeFileDescriptorResponse = {
          quoteId: quoteId || "",
          files: [],
          error: "unauthorized",
        };
        return new Response(JSON.stringify(resp), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      }
    }

    const supabaseKey = serviceRoleKey || anonKey;
    if (!supabaseKey) {
      throw new Error("missing_SUPABASE_KEY");
    }

    const body = (await req.json().catch(() => null)) as { quoteId?: unknown } | null;
    quoteId = normalizeId(body?.quoteId);
    if (!quoteId) {
      return new Response(
        JSON.stringify({ quoteId: "", files: [], error: "missing_quoteId" } satisfies EdgeFileDescriptorResponse),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders() } },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: uploadFiles, error: uploadFilesError } = await supabase
      .from("quote_upload_files")
      .select("id,upload_id,path,filename,extension,is_from_archive,size_bytes,created_at")
      .eq("quote_id", quoteId)
      .order("created_at", { ascending: true })
      .returns<(QuoteUploadFileRow & { created_at: string | null })[]>();

    if (uploadFilesError) {
      throw uploadFilesError;
    }

    const filesList = Array.isArray(uploadFiles) ? uploadFiles : [];
    if (filesList.length === 0) {
      const resp: EdgeFileDescriptorResponse = { quoteId, files: [] };
      return new Response(JSON.stringify(resp), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    const nonArchiveNames = Array.from(
      new Set(
        filesList
          .filter((f) => !f.is_from_archive)
          .map((f) => (typeof f.path === "string" ? f.path.trim() : ""))
          .filter(Boolean),
      ),
    );

    const filesMetaByName = new Map<string, FilesRow>();
    if (nonArchiveNames.length > 0) {
      const { data: filesMeta, error: filesMetaError } = await supabase
        .from("files")
        .select("filename,storage_path,bucket_id,mime")
        .eq("quote_id", quoteId)
        .in("filename", nonArchiveNames)
        .returns<FilesRow[]>();

      if (!filesMetaError && Array.isArray(filesMeta)) {
        for (const row of filesMeta) {
          const name = typeof row?.filename === "string" ? row.filename.trim() : "";
          const storagePath = typeof row?.storage_path === "string" ? row.storage_path.trim() : "";
          if (!name || !storagePath) continue;
          filesMetaByName.set(name, row);
        }
      }
    }

    const archiveUploadIds = Array.from(
      new Set(
        filesList
          .filter((f) => f.is_from_archive)
          .map((f) => normalizeId(f.upload_id))
          .filter(Boolean),
      ),
    );

    const uploadsById = new Map<string, UploadRow>();
    if (archiveUploadIds.length > 0) {
      const { data: uploads, error: uploadsError } = await supabase
        .from("uploads")
        .select("id,file_path,file_name,mime_type")
        .in("id", archiveUploadIds)
        .returns<UploadRow[]>();

      if (!uploadsError && Array.isArray(uploads)) {
        for (const row of uploads) {
          const id = normalizeId(row?.id);
          if (id) uploadsById.set(id, row);
        }
      }
    }

    const zipBufferByUploadId = new Map<string, ArrayBuffer>();

    const descriptors: EdgeFileDescriptor[] = [];

    for (const f of filesList) {
      const id = normalizeId(f.id);
      const fileName = typeof f.filename === "string" ? f.filename.trim() : "";
      const path = typeof f.path === "string" ? f.path.trim() : "";
      const ext = normalizeExtension(f.extension);

      const kind = classifyUploadFileType({ filename: fileName, extension: ext });
      const classification = toDescriptorClassification(kind);

      let mimeType: string | null = null;
      if (!f.is_from_archive) {
        const key = typeof f.path === "string" ? f.path.trim() : "";
        const meta = key ? filesMetaByName.get(key) ?? null : null;
        mimeType = (meta?.mime ?? null) ? String(meta?.mime) : guessMimeTypeFromExtension(ext);
      } else {
        mimeType = guessMimeTypeFromExtension(ext);
      }

      let sampleText: string | undefined;

      if (classification === "Drawing" && ext === "pdf") {
        try {
          let pdfBytes: Uint8Array | null = null;

          if (f.is_from_archive) {
            const uploadId = normalizeId(f.upload_id);
            const upload = uploadId ? uploadsById.get(uploadId) ?? null : null;
            const uploadFilePath = typeof upload?.file_path === "string" ? upload.file_path.trim() : "";
            if (uploadId && uploadFilePath) {
              let zipBuffer = zipBufferByUploadId.get(uploadId) ?? null;
              if (!zipBuffer) {
                const parsed = parseStoragePath(uploadFilePath);
                if (parsed) {
                  const { data: downloaded, error: downloadError } = await supabase.storage
                    .from(parsed.bucket)
                    .download(parsed.key);
                  if (!downloadError && downloaded) {
                    zipBuffer = await downloaded.arrayBuffer();
                    zipBufferByUploadId.set(uploadId, zipBuffer);
                  }
                }
              }

              if (zipBuffer) {
                const zip = await JSZip.loadAsync(zipBuffer);
                const entryPath = (f.path ?? "").replace(/^\/+/, "").trim();
                const normalizedEntry = entryPath.replace(/\\/g, "/");
                const file = zip.file(entryPath) ?? zip.file(normalizedEntry) ?? null;
                if (file) {
                  const bytes = await file.async("uint8array");
                  pdfBytes = bytes;
                }
              }
            }
          } else {
            const originalName = typeof f.path === "string" ? f.path.trim() : "";
            const meta = originalName ? filesMetaByName.get(originalName) ?? null : null;
            const storagePath = typeof meta?.storage_path === "string" ? meta.storage_path.trim() : "";
            if (storagePath) {
              const parsed = parseStoragePath(storagePath);
              if (parsed) {
                const { data: downloaded, error: downloadError } = await supabase.storage
                  .from(parsed.bucket)
                  .download(parsed.key);
                if (!downloadError && downloaded) {
                  pdfBytes = new Uint8Array(await downloaded.arrayBuffer());
                }
              }
            }
          }

          if (pdfBytes && pdfBytes.byteLength > 0) {
            const extracted = await extractPdfFirstPageText(pdfBytes, MAX_PDF_SAMPLE_CHARS);
            if (extracted) {
              sampleText = extracted;
            }
          }
        } catch (error) {
          console.warn("[parts-file-descriptors] pdf extract failed", {
            quoteId,
            fileId: id,
            error,
          });
        }
      }

      descriptors.push({
        id,
        fileName: fileName || path || id,
        path: path || fileName || id,
        mimeType,
        classification,
        sampleText,
      });
    }

    const resp: EdgeFileDescriptorResponse = {
      quoteId,
      files: descriptors,
    };

    return new Response(JSON.stringify(resp), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[parts-file-descriptors] failed", { quoteId, error });

    const resp: EdgeFileDescriptorResponse = {
      quoteId: quoteId || "",
      files: [],
      error: message || "unknown_error",
    };

    return new Response(JSON.stringify(resp), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }
});
