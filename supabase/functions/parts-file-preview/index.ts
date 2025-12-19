// Supabase Edge Function: parts-file-preview
//
// Fetches a specific quote_upload_files entry (including ZIP members) and returns
// the original file bytes for inline preview / download.
//
// Env:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY (preferred) or SUPABASE_ANON_KEY
//
// Request:
//   { "quoteId": string, "fileId": string, "disposition"?: "inline" | "attachment" }
//
// Response:
//   Raw bytes (Content-Type inferred), plus Content-Disposition.

import { createClient } from "jsr:@supabase/supabase-js@2";
import JSZip from "npm:jszip@3.10.1";

type QuoteUploadFileRow = {
  id: string;
  upload_id: string;
  quote_id: string;
  path: string;
  filename: string;
  extension: string | null;
  is_from_archive: boolean;
};

type UploadRow = {
  id: string;
  file_path: string | null;
};

type FilesRow = {
  filename: string;
  storage_path: string;
  bucket_id: string | null;
  mime: string | null;
};

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeExtension(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.startsWith(".") ? trimmed.slice(1) : trimmed;
}

function guessMimeTypeFromExtension(ext: string | null): string {
  const e = (ext ?? "").trim().toLowerCase();
  if (e === "pdf") return "application/pdf";
  if (e === "zip") return "application/zip";
  if (e === "dwg") return "application/acad";
  if (e === "dxf") return "application/dxf";
  if (e === "step" || e === "stp") return "application/step";
  if (e === "iges" || e === "igs") return "model/iges";
  if (e === "stl") return "model/stl";
  return "application/octet-stream";
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
  let fileId = "";

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    if (!supabaseUrl) throw new Error("missing_SUPABASE_URL");

    // If service role is configured, require it as bearer token.
    if (serviceRoleKey) {
      const auth = req.headers.get("authorization") ?? "";
      if (auth !== `Bearer ${serviceRoleKey}`) {
        return new Response("unauthorized", {
          status: 401,
          headers: { ...corsHeaders() },
        });
      }
    }

    const supabaseKey = serviceRoleKey || anonKey;
    if (!supabaseKey) throw new Error("missing_SUPABASE_KEY");

    const body = (await req.json().catch(() => null)) as
      | { quoteId?: unknown; fileId?: unknown; disposition?: unknown }
      | null;

    quoteId = normalizeId(body?.quoteId);
    fileId = normalizeId(body?.fileId);
    const disposition =
      typeof body?.disposition === "string" && body.disposition === "attachment"
        ? "attachment"
        : "inline";

    if (!quoteId || !fileId) {
      return new Response("missing_identifiers", {
        status: 400,
        headers: { ...corsHeaders() },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: uploadFile, error: uploadFileError } = await supabase
      .from("quote_upload_files")
      .select("id,upload_id,quote_id,path,filename,extension,is_from_archive")
      .eq("id", fileId)
      .eq("quote_id", quoteId)
      .maybeSingle<QuoteUploadFileRow>();

    if (uploadFileError || !uploadFile?.id) {
      return new Response("not_found", {
        status: 404,
        headers: { ...corsHeaders() },
      });
    }

    const ext = normalizeExtension(uploadFile.extension) ?? normalizeExtension(uploadFile.filename) ?? null;
    let bytes: Uint8Array | null = null;
    let mimeType: string | null = null;

    if (uploadFile.is_from_archive) {
      const uploadId = normalizeId(uploadFile.upload_id);
      const { data: uploadRow } = await supabase
        .from("uploads")
        .select("id,file_path")
        .eq("id", uploadId)
        .maybeSingle<UploadRow>();

      const uploadFilePath = typeof uploadRow?.file_path === "string" ? uploadRow.file_path.trim() : "";
      const parsed = uploadFilePath ? parseStoragePath(uploadFilePath) : null;
      if (!parsed) {
        return new Response("archive_unavailable", {
          status: 404,
          headers: { ...corsHeaders() },
        });
      }

      const { data: downloaded, error: downloadError } = await supabase.storage
        .from(parsed.bucket)
        .download(parsed.key);

      if (downloadError || !downloaded) {
        return new Response("archive_download_failed", {
          status: 500,
          headers: { ...corsHeaders() },
        });
      }

      const zipBuffer = await downloaded.arrayBuffer();
      const zip = await JSZip.loadAsync(zipBuffer);
      const entryPath = (uploadFile.path ?? "").replace(/^\/+/, "").trim();
      const normalizedEntry = entryPath.replace(/\\/g, "/");
      const file = zip.file(entryPath) ?? zip.file(normalizedEntry) ?? null;
      if (!file) {
        return new Response("archive_entry_not_found", {
          status: 404,
          headers: { ...corsHeaders() },
        });
      }

      bytes = await file.async("uint8array");
      mimeType = guessMimeTypeFromExtension(ext);
    } else {
      const keyName = typeof uploadFile.path === "string" ? uploadFile.path.trim() : "";

      const { data: fileMeta } = await supabase
        .from("files")
        .select("filename,storage_path,bucket_id,mime")
        .eq("quote_id", quoteId)
        .eq("filename", keyName)
        .maybeSingle<FilesRow>();

      const storagePath = typeof fileMeta?.storage_path === "string" ? fileMeta.storage_path.trim() : "";
      const bucketId = typeof fileMeta?.bucket_id === "string" && fileMeta.bucket_id.trim() ? fileMeta.bucket_id.trim() : null;

      const parsed = storagePath ? parseStoragePath(storagePath) : bucketId && keyName ? { bucket: bucketId, key: keyName } : null;
      if (!parsed) {
        return new Response("file_unavailable", {
          status: 404,
          headers: { ...corsHeaders() },
        });
      }

      const { data: downloaded, error: downloadError } = await supabase.storage
        .from(parsed.bucket)
        .download(parsed.key);

      if (downloadError || !downloaded) {
        return new Response("download_failed", {
          status: 500,
          headers: { ...corsHeaders() },
        });
      }

      bytes = new Uint8Array(await downloaded.arrayBuffer());
      mimeType =
        typeof fileMeta?.mime === "string" && fileMeta.mime.trim().length > 0
          ? fileMeta.mime
          : guessMimeTypeFromExtension(ext);
    }

    if (!bytes || bytes.byteLength === 0) {
      return new Response("empty", {
        status: 500,
        headers: { ...corsHeaders() },
      });
    }

    const fileName = uploadFile.filename || uploadFile.path || uploadFile.id;

    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": mimeType || "application/octet-stream",
        "Content-Disposition": `${disposition}; filename=\"${fileName.replace(/\"/g, "") || "file"}\"`,
        ...corsHeaders(),
      },
    });
  } catch (error) {
    console.error("[parts-file-preview] failed", { quoteId, fileId, error });
    return new Response("error", {
      status: 500,
      headers: { ...corsHeaders() },
    });
  }
});
