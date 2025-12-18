import OpenAI from "openai";
import AdmZip from "adm-zip";
import { supabaseServer } from "@/lib/supabaseServer";
import { classifyUploadFileType } from "@/lib/uploads/classifyFileType";

export type AiPartSuggestion = {
  label: string; // human-friendly part label
  partNumber?: string | null;
  fileIds: string[]; // quote_upload_files IDs (CAD + drawings)
  confidence: number; // 0–100
  rationale?: string; // optional human-readable explanation
};

export type AiPartsSuggestionResult = {
  suggestions: AiPartSuggestion[];
  modelVersion: string;
};

type AiFileDescriptor = {
  id: string;
  name: string;
  path: string;
  classification: "CAD" | "Drawing" | "Other";
  sampleText?: string;
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
  mime_type: string | null;
};

type FilesRow = {
  filename: string;
  storage_path: string;
  bucket_id: string | null;
  mime: string | null;
};

type CachedRow = {
  suggestions: unknown;
  model_version: string;
};

const DEFAULT_MODEL = "gpt-4.1-mini";
const MAX_PDF_SAMPLE_CHARS = 3500;

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

function toDescriptorClassification(kind: ReturnType<typeof classifyUploadFileType>): AiFileDescriptor["classification"] {
  if (kind === "cad") return "CAD";
  if (kind === "drawing") return "Drawing";
  return "Other";
}

async function extractPdfFirstPageText(pdfBuffer: Buffer, maxChars: number): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Ensure Node runs without trying to spawn a worker.
  try {
    (pdfjs as any).GlobalWorkerOptions.workerSrc = "";
  } catch {
    // ignore
  }

  const doc = await (pdfjs as any).getDocument({ data: pdfBuffer }).promise;
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

function safeJsonStringify(value: unknown, maxChars: number): string {
  try {
    const out = JSON.stringify(value);
    if (typeof out === "string" && out.length > maxChars) {
      return out.slice(0, maxChars) + "…";
    }
    return out;
  } catch {
    return "";
  }
}

function coerceSuggestion(raw: any, allowedFileIds: Set<string>): AiPartSuggestion | null {
  const label = typeof raw?.label === "string" ? raw.label.trim() : "";
  if (!label) return null;

  const partNumberRaw = raw?.partNumber;
  const partNumber =
    partNumberRaw === null
      ? null
      : typeof partNumberRaw === "string"
        ? partNumberRaw.trim() || null
        : null;

  const fileIdsIn = Array.isArray(raw?.fileIds) ? raw.fileIds : [];
  const fileIds: string[] = [];
  const seen = new Set<string>();
  for (const v of fileIdsIn) {
    const id = normalizeId(v);
    if (!id || seen.has(id)) continue;
    if (!allowedFileIds.has(id)) continue;
    seen.add(id);
    fileIds.push(id);
  }
  if (fileIds.length === 0) return null;

  const confidenceRaw = raw?.confidence;
  const confidence =
    typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(100, Math.round(confidenceRaw)))
      : 0;

  const rationale = typeof raw?.rationale === "string" ? raw.rationale.trim() : "";

  return {
    label,
    partNumber,
    fileIds,
    confidence,
    rationale: rationale || undefined,
  };
}

function getOpenAiClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey, timeout: 25_000 });
}

export async function loadCachedAiPartSuggestions(
  quoteId: string,
): Promise<AiPartsSuggestionResult | null> {
  const normalizedQuoteId = normalizeId(quoteId);
  if (!normalizedQuoteId) return null;

  const { data, error } = await supabaseServer
    .from("quote_parts_ai_suggestions")
    .select("suggestions,model_version,created_at")
    .eq("quote_id", normalizedQuoteId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<CachedRow & { created_at: string }>();

  if (error || !data) {
    return null;
  }

  const modelVersion =
    typeof data.model_version === "string" && data.model_version.trim().length > 0
      ? data.model_version.trim()
      : "unknown";

  const rawSuggestions = data.suggestions;
  if (!Array.isArray(rawSuggestions)) {
    return { suggestions: [], modelVersion };
  }

  const suggestions = rawSuggestions
    .map((s): AiPartSuggestion | null => {
      if (!s || typeof s !== "object") return null;
      const label = typeof (s as any).label === "string" ? (s as any).label.trim() : "";
      const fileIds = Array.isArray((s as any).fileIds) ? (s as any).fileIds : [];
      const confidence = typeof (s as any).confidence === "number" ? (s as any).confidence : 0;
      const partNumber =
        (s as any).partNumber === null
          ? null
          : typeof (s as any).partNumber === "string"
            ? (s as any).partNumber.trim() || null
            : null;
      const rationale = typeof (s as any).rationale === "string" ? (s as any).rationale : undefined;

      if (!label || !Array.isArray(fileIds) || fileIds.length === 0) return null;
      return {
        label,
        partNumber,
        fileIds: fileIds
          .filter((v: any) => typeof v === "string")
          .map((v: string) => v.trim())
          .filter(Boolean),
        confidence:
          typeof confidence === "number" && Number.isFinite(confidence)
            ? Math.max(0, Math.min(100, Math.round(confidence)))
            : 0,
        rationale: rationale?.trim() || undefined,
      };
    })
    .filter((s: AiPartSuggestion | null): s is AiPartSuggestion => Boolean(s));

  return { suggestions, modelVersion };
}

export async function generateAiPartSuggestionsForQuote(
  quoteId: string,
): Promise<AiPartsSuggestionResult> {
  const normalizedQuoteId = normalizeId(quoteId);
  if (!normalizedQuoteId) {
    return { suggestions: [], modelVersion: "error" };
  }

  const modelVersion =
    typeof process.env.OPENAI_PARTS_SUGGESTIONS_MODEL === "string" &&
    process.env.OPENAI_PARTS_SUGGESTIONS_MODEL.trim().length > 0
      ? process.env.OPENAI_PARTS_SUGGESTIONS_MODEL.trim()
      : DEFAULT_MODEL;

  try {
    const openai = getOpenAiClient();
    if (!openai) {
      console.error("[ai parts suggestions] missing OPENAI_API_KEY");
      return { suggestions: [], modelVersion: "error" };
    }

    const { data: uploadFiles, error: uploadFilesError } = await supabaseServer
      .from("quote_upload_files")
      .select("id,upload_id,path,filename,extension,is_from_archive,size_bytes")
      .eq("quote_id", normalizedQuoteId)
      .order("created_at", { ascending: true })
      .returns<QuoteUploadFileRow[]>();

    if (uploadFilesError) {
      console.error("[ai parts suggestions] failed to load quote_upload_files", uploadFilesError);
      return { suggestions: [], modelVersion: "error" };
    }

    const filesList = Array.isArray(uploadFiles) ? uploadFiles : [];
    if (filesList.length === 0) {
      return { suggestions: [], modelVersion };
    }

    const allowedFileIds = new Set(filesList.map((f) => normalizeId(f.id)).filter(Boolean));
    const uploadIds = Array.from(
      new Set(filesList.map((f) => normalizeId(f.upload_id)).filter(Boolean)),
    );

    const uploadsById = new Map<string, UploadRow>();
    if (uploadIds.length > 0) {
      const { data: uploads, error: uploadsError } = await supabaseServer
        .from("uploads")
        .select("id,file_path,mime_type")
        .in("id", uploadIds)
        .returns<UploadRow[]>();

      if (!uploadsError && Array.isArray(uploads)) {
        for (const row of uploads) {
          const id = normalizeId(row?.id);
          if (id) uploadsById.set(id, row);
        }
      }
    }

    // For non-archive uploads, we can often map original filenames -> storage_path via public.files.
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
      const { data: filesMeta, error: filesMetaError } = await supabaseServer
        .from("files")
        .select("filename,storage_path,bucket_id,mime")
        .eq("quote_id", normalizedQuoteId)
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

    // Best-effort: extract title-block/notes text from 1st page of drawing PDFs.
    const zipBufferByUploadId = new Map<string, Buffer>();
    const sampleTextByFileId = new Map<string, string>();

    for (const f of filesList) {
      const fileId = normalizeId(f.id);
      if (!fileId) continue;

      const ext = typeof f.extension === "string" ? f.extension.trim().toLowerCase() : "";
      const kind = classifyUploadFileType({ filename: f.filename, extension: f.extension ?? null });
      const classification = toDescriptorClassification(kind);
      if (classification !== "Drawing") continue;
      if (ext !== "pdf") continue;

      try {
        let pdfBuffer: Buffer | null = null;

        if (f.is_from_archive) {
          const uploadId = normalizeId(f.upload_id);
          const upload = uploadId ? uploadsById.get(uploadId) ?? null : null;
          const uploadFilePath = typeof upload?.file_path === "string" ? upload.file_path.trim() : "";
          if (!uploadId || !uploadFilePath) continue;

          let zipBuffer = zipBufferByUploadId.get(uploadId) ?? null;
          if (!zipBuffer) {
            const parsed = parseStoragePath(uploadFilePath);
            if (!parsed) continue;
            const { data: downloaded, error: downloadError } = await supabaseServer.storage
              .from(parsed.bucket)
              .download(parsed.key);
            if (downloadError || !downloaded) continue;
            zipBuffer = Buffer.from(await downloaded.arrayBuffer());
            zipBufferByUploadId.set(uploadId, zipBuffer);
          }

          const zip = new AdmZip(zipBuffer);
          const entryPath = typeof f.path === "string" ? f.path.replace(/^\/+/, "").trim() : "";
          if (!entryPath) continue;
          const entry =
            zip.getEntry(entryPath) ??
            zip.getEntry(entryPath.replace(/\\/g, "/")) ??
            null;
          if (!entry) continue;
          pdfBuffer = entry.getData();
        } else {
          const originalName = typeof f.path === "string" ? f.path.trim() : "";
          const meta = originalName ? filesMetaByName.get(originalName) ?? null : null;
          const storagePath = typeof meta?.storage_path === "string" ? meta.storage_path.trim() : "";
          if (!storagePath) continue;
          const parsed = parseStoragePath(storagePath);
          if (!parsed) continue;
          const { data: downloaded, error: downloadError } = await supabaseServer.storage
            .from(parsed.bucket)
            .download(parsed.key);
          if (downloadError || !downloaded) continue;
          pdfBuffer = Buffer.from(await downloaded.arrayBuffer());
        }

        if (!pdfBuffer || pdfBuffer.byteLength === 0) continue;
        const text = await extractPdfFirstPageText(pdfBuffer, MAX_PDF_SAMPLE_CHARS);
        if (text) {
          sampleTextByFileId.set(fileId, text);
        }
      } catch (error) {
        console.warn("[ai parts suggestions] pdf text extract failed", {
          quoteId: normalizedQuoteId,
          fileId,
          error,
        });
      }
    }

    const descriptors: AiFileDescriptor[] = filesList.map((f) => {
      const id = normalizeId(f.id);
      const name = typeof f.filename === "string" ? f.filename.trim() : "";
      const path = typeof f.path === "string" ? f.path.trim() : "";
      const kind = classifyUploadFileType({ filename: name, extension: f.extension ?? null });
      const classification = toDescriptorClassification(kind);
      const sampleText = sampleTextByFileId.get(id) ?? undefined;
      return {
        id,
        name: name || path || id,
        path: path || name || id,
        classification,
        sampleText,
      };
    });

    const systemPrompt = [
      "You are assisting a manufacturing RFQ intake system.",
      "You receive a list of CAD models and technical drawings for a single quote.",
      "Your task is to group files into parts, decide which drawings belong with which CAD files, and propose a part label and part number when possible.",
      "Use filenames, folders, and drawing sampleText to infer grouping.",
      "If multiple drawings belong to the same part, include them in the same part group.",
      "sampleText is raw text extracted from the drawing title block and notes (first page only). Use it to infer part numbers and labels when helpful.",
      'Output strict JSON as: {"parts":[{"label":string,"partNumber":string|null,"fileIds":string[],"confidence":number(0-100),"rationale":string}]}',
    ].join("\n");

    const userPayload = {
      quoteId: normalizedQuoteId,
      files: descriptors,
    };

    const completion = await openai.chat.completions.create({
      model: modelVersion,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: safeJsonStringify(userPayload, 80_000),
        },
      ],
    });

    const content = completion.choices?.[0]?.message?.content ?? "";
    if (!content) {
      console.error("[ai parts suggestions] empty response content");
      return { suggestions: [], modelVersion: "error" };
    }

    let parsed: any = null;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      console.error("[ai parts suggestions] invalid JSON response", {
        error,
        contentPreview: content.slice(0, 500),
      });
      return { suggestions: [], modelVersion: "error" };
    }

    const partsRaw = Array.isArray(parsed?.parts) ? parsed.parts : [];
    const suggestions = partsRaw
      .map((p: any) => coerceSuggestion(p, allowedFileIds))
      .filter((s: AiPartSuggestion | null): s is AiPartSuggestion => Boolean(s))
      .sort((a: AiPartSuggestion, b: AiPartSuggestion) => (b.confidence ?? 0) - (a.confidence ?? 0));

    // Persist the parsed suggestions as the cache/record for this quote.
    const { error: insertError } = await supabaseServer
      .from("quote_parts_ai_suggestions")
      .insert({
        quote_id: normalizedQuoteId,
        suggestions,
        model_version: modelVersion,
      });

    if (insertError) {
      console.warn("[ai parts suggestions] failed to cache suggestions", insertError);
    }

    return { suggestions, modelVersion };
  } catch (error) {
    console.error("[ai parts suggestions] generation failed", {
      quoteId: normalizedQuoteId,
      error,
    });
    return { suggestions: [], modelVersion: "error" };
  }
}

