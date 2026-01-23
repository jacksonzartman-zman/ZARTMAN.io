import "server-only";

import OpenAI from "openai";
import { supabaseServer } from "@/lib/supabaseServer";
import { schemaGate } from "@/server/db/schemaContract";
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

type EdgeFileDescriptor = {
  id: string; // quote_upload_files.id
  fileName: string;
  path: string;
  mimeType: string | null;
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

type CachedRow = {
  suggestions: unknown;
  model_version: string;
};

const DEFAULT_MODEL = "gpt-4.1-mini";

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toDescriptorClassification(kind: ReturnType<typeof classifyUploadFileType>): AiFileDescriptor["classification"] {
  if (kind === "cad") return "CAD";
  if (kind === "drawing") return "Drawing";
  return "Other";
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

async function fetchEdgeFileDescriptors(quoteId: string): Promise<EdgeFileDescriptor[]> {
  const normalizedQuoteId = normalizeId(quoteId);
  if (!normalizedQuoteId) return [];

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!baseUrl || typeof baseUrl !== "string" || baseUrl.trim().length === 0) {
    console.error("[ai parts suggestions] missing NEXT_PUBLIC_SUPABASE_URL");
    return [];
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/functions/v1/parts-file-descriptors`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.SUPABASE_SERVICE_ROLE_KEY
          ? { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` }
          : {}),
      },
      body: JSON.stringify({ quoteId: normalizedQuoteId }),
    });

    if (!res.ok) {
      console.error("[ai parts suggestions] edge function failed", {
        quoteId: normalizedQuoteId,
        status: res.status,
      });
      return [];
    }

    const json = (await res.json()) as {
      quoteId: string;
      files: EdgeFileDescriptor[];
      error?: string;
    };

    if (json?.error) {
      console.error("[ai parts suggestions] edge function reported error", json);
    }

    return Array.isArray(json?.files) ? json.files : [];
  } catch (error) {
    console.error("[ai parts suggestions] edge function request crashed", {
      quoteId: normalizedQuoteId,
      error,
    });
    return [];
  }
}

export async function loadCachedAiPartSuggestions(
  quoteId: string,
): Promise<AiPartsSuggestionResult | null> {
  const normalizedQuoteId = normalizeId(quoteId);
  if (!normalizedQuoteId) return null;

  const { data, error } = await supabaseServer()
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

    const hasUploadsSchema = await schemaGate({
      enabled: true,
      relation: "quote_upload_files",
      requiredColumns: ["quote_id", "id", "upload_id", "path", "filename", "extension", "is_from_archive", "size_bytes"],
      warnPrefix: "[quote_upload_files]",
    });
    if (!hasUploadsSchema) {
      return { suggestions: [], modelVersion };
    }

    const { data: uploadFiles, error: uploadFilesError } = await supabaseServer()
      .from("quote_upload_files")
      .select("id,upload_id,path,filename,extension,is_from_archive,size_bytes")
      .eq("quote_id", normalizedQuoteId)
      .order("id", { ascending: true })
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

    // Prefer Edge-produced descriptors (includes sampleText for drawing PDFs).
    const edgeFiles = await fetchEdgeFileDescriptors(normalizedQuoteId);
    const edgeDescriptors: AiFileDescriptor[] = (edgeFiles ?? [])
      .map((f) => ({
        id: normalizeId(f?.id),
        name: typeof f?.fileName === "string" ? f.fileName.trim() : "",
        path: typeof f?.path === "string" ? f.path.trim() : "",
        classification: f?.classification ?? "Other",
        sampleText: typeof f?.sampleText === "string" && f.sampleText.trim().length > 0 ? f.sampleText : undefined,
      }))
      .filter((f) => Boolean(f.id) && allowedFileIds.has(f.id));

    // Fallback (no heavy processing): filenames + paths only.
    const fallbackDescriptors: AiFileDescriptor[] = filesList.map((f) => {
      const id = normalizeId(f.id);
      const name = typeof f.filename === "string" ? f.filename.trim() : "";
      const path = typeof f.path === "string" ? f.path.trim() : "";
      const kind = classifyUploadFileType({ filename: name, extension: f.extension ?? null });
      const classification = toDescriptorClassification(kind);
      return {
        id,
        name: name || path || id,
        path: path || name || id,
        classification,
      };
    });

    const descriptors: AiFileDescriptor[] =
      edgeDescriptors.length > 0
        ? edgeDescriptors
        : (console.info("[ai parts suggestions] edge descriptors unavailable; continuing without sampleText", {
            quoteId: normalizedQuoteId,
          }),
          fallbackDescriptors);

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
    const { error: insertError } = await supabaseServer()
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

