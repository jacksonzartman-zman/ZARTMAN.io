import { supabaseServer } from "@/lib/supabaseServer";
import { getAdapterForProvider, type OutboundRfqFileLink } from "@/lib/adapters/providerAdapter";
import { loadAdminUploadDetail } from "@/server/admin/uploads";
import { isMissingTableOrColumnError, serializeSupabaseError } from "@/server/admin/logging";
import type { ProviderRow } from "@/server/providers";
import type { QuoteFileSource } from "@/server/quotes/types";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

type QuoteRow = Pick<
  QuoteFileSource,
  "id" | "upload_id" | "file_name" | "file_names" | "upload_file_names"
> & {
  customer_name: string | null;
  customer_email: string | null;
  company: string | null;
  target_date: string | null;
  upload_name?: string | null;
};

type DestinationRow = {
  id: string;
  rfq_id: string;
  provider_id: string;
};

type RawFileRow = {
  id?: string | null;
  filename?: string | null;
  bucket_id?: string | null;
  storage_bucket_id?: string | null;
  storage_path?: string | null;
  file_path?: string | null;
  path?: string | null;
};

type FileLoadResult =
  | { ok: true; rows: RawFileRow[] }
  | { ok: false; missing: true }
  | { ok: false; missing: false; error: string };

type OutboundEmailResult =
  | { ok: true; subject: string; body: string }
  | { ok: false; error: string };

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeId(value: unknown): string {
  return normalizeString(value);
}

type SerializedSupabaseErrorLike = {
  message?: unknown;
  code?: unknown;
};

function serializeSupabaseErrorString(error: unknown): string {
  const serialized = serializeSupabaseError(error);
  if (serialized && typeof serialized === "object") {
    const message =
      typeof (serialized as SerializedSupabaseErrorLike).message === "string"
        ? (serialized as SerializedSupabaseErrorLike).message.trim()
        : "";
    if (message) return message;
    const code =
      typeof (serialized as SerializedSupabaseErrorLike).code === "string"
        ? (serialized as SerializedSupabaseErrorLike).code.trim()
        : "";
    if (code) return code;
    return "unknown_error";
  }
  const fallback = JSON.stringify(serialized);
  return fallback ? fallback : "unknown_error";
}

function canonicalizeCadBucketId(input: unknown): string {
  const raw = normalizeString(input);
  if (!raw) return "";
  if (raw === "cad-uploads") return "cad_uploads";
  if (raw === "cad_uploads") return "cad_uploads";
  if (raw === "cad-previews") return "cad_previews";
  if (raw === "cad_previews") return "cad_previews";
  return raw;
}

function normalizeStoragePath(path: string, bucket: string): string {
  let normalized = normalizeString(path).replace(/^\/+/, "");
  if (!normalized) return "";
  const canonicalBucket = canonicalizeCadBucketId(bucket) || bucket;
  if (canonicalBucket && normalized.startsWith(`${canonicalBucket}/`)) {
    normalized = normalized.slice(canonicalBucket.length + 1);
  } else if (canonicalBucket === "cad_uploads" && normalized.startsWith("cad-uploads/")) {
    normalized = normalized.slice("cad-uploads/".length);
  } else if (canonicalBucket === "cad_previews" && normalized.startsWith("cad-previews/")) {
    normalized = normalized.slice("cad-previews/".length);
  }
  return normalized.replace(/^\/+/, "");
}

function basename(path: string): string {
  const normalized = normalizeString(path);
  if (!normalized) return "";
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function buildPortalLink(path: string): string {
  return `${SITE_URL}${path}`;
}

function buildDownloadUrl(bucket: string, path: string, filename: string): string {
  const qs = new URLSearchParams();
  qs.set("bucket", bucket);
  qs.set("path", path);
  qs.set("disposition", "attachment");
  if (filename) {
    qs.set("filename", filename);
  }
  return buildPortalLink(`/api/storage-download?${qs.toString()}`);
}

async function loadFileRowsFromRelation(
  relation: "files_valid_compat" | "files_valid" | "files",
  quoteId: string,
): Promise<FileLoadResult> {
  try {
    const { data, error } = await supabaseServer
      .from(relation)
      .select("*")
      .eq("quote_id", quoteId)
      .limit(75)
      .returns<RawFileRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return { ok: false, missing: true };
      }
      return {
        ok: false,
        missing: false,
        error: serializeSupabaseErrorString(error),
      };
    }

    return { ok: true, rows: Array.isArray(data) ? data : [] };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return { ok: false, missing: true };
    }
    return {
      ok: false,
      missing: false,
      error: serializeSupabaseErrorString(error),
    };
  }
}

async function loadOutboundFileLinks(quoteId: string): Promise<
  | { ok: true; links: OutboundRfqFileLink[] }
  | { ok: false; error: string }
> {
  const relations: Array<"files_valid_compat" | "files_valid" | "files"> = [
    "files_valid_compat",
    "files_valid",
    "files",
  ];

  for (const relation of relations) {
    const result = await loadFileRowsFromRelation(relation, quoteId);
    if (!result.ok) {
      if (result.missing) {
        continue;
      }
      return {
        ok: false,
        error: "Unable to load RFQ files right now. Please try again.",
      };
    }

    const seen = new Set<string>();
    const links: OutboundRfqFileLink[] = [];
    for (const row of result.rows) {
      const rawBucket = row.bucket_id ?? row.storage_bucket_id ?? null;
      const bucket = canonicalizeCadBucketId(rawBucket);
      const rawPath = row.storage_path ?? row.file_path ?? row.path ?? null;
      const path = rawPath ? normalizeStoragePath(rawPath, bucket) : "";
      if (!bucket || !path) continue;
      if (bucket === "cad_previews") continue;

      const filename = normalizeString(row.filename) || basename(path) || "file";
      const dedupeKey = `${bucket}:${path}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      links.push({
        label: filename,
        url: buildDownloadUrl(bucket, path, filename),
      });
    }

    return { ok: true, links };
  }

  return {
    ok: false,
    error: "File metadata is unavailable in this environment.",
  };
}

async function loadQuoteTitle(quoteId: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseServer
      .from("quotes")
      .select("title")
      .eq("id", quoteId)
      .maybeSingle<{ title?: string | null }>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return null;
      }
      console.warn("[rfq outbound email] quote title lookup failed", {
        quoteId,
        error: serializeSupabaseError(error),
      });
      return null;
    }

    const title = normalizeString(data?.title);
    return title || null;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return null;
    }
    console.warn("[rfq outbound email] quote title lookup crashed", {
      quoteId,
      error: serializeSupabaseError(error) ?? error,
    });
    return null;
  }
}

function buildFullName(first: string, last: string): string | null {
  const parts = [normalizeString(first), normalizeString(last)].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

function pickFirst(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) return normalized;
  }
  return null;
}

export async function buildDestinationOutboundEmail(args: {
  quoteId: string;
  destinationId: string;
}): Promise<OutboundEmailResult> {
  const quoteId = normalizeId(args.quoteId);
  const destinationId = normalizeId(args.destinationId);
  if (!quoteId || !destinationId) {
    return { ok: false, error: "Missing RFQ identifiers." };
  }

  const { data: destination, error: destinationError } = await supabaseServer
    .from("rfq_destinations")
    .select("id,rfq_id,provider_id")
    .eq("id", destinationId)
    .eq("rfq_id", quoteId)
    .maybeSingle<DestinationRow>();

  if (destinationError) {
    if (isMissingTableOrColumnError(destinationError)) {
      return { ok: false, error: "RFQ destinations are not available in this environment." };
    }
    console.error("[rfq outbound email] destination lookup failed", {
      destinationId,
      quoteId,
      error: serializeSupabaseError(destinationError),
    });
    return { ok: false, error: "Unable to load this destination right now." };
  }

  if (!destination?.id) {
    return { ok: false, error: "RFQ destination not found." };
  }

  const { data: provider, error: providerError } = await supabaseServer
    .from("providers")
    .select("id,name,provider_type,quoting_mode,is_active,website,notes,created_at")
    .eq("id", destination.provider_id)
    .maybeSingle<ProviderRow>();

  if (providerError) {
    if (isMissingTableOrColumnError(providerError)) {
      return { ok: false, error: "Providers are not available in this environment." };
    }
    console.error("[rfq outbound email] provider lookup failed", {
      destinationId,
      providerId: destination.provider_id,
      error: serializeSupabaseError(providerError),
    });
    return { ok: false, error: "Unable to load this provider right now." };
  }

  if (!provider?.id) {
    return { ok: false, error: "Provider record not found." };
  }

  const { data: quote, error: quoteError } = await supabaseServer
    .from("quotes_with_uploads")
    .select(
      "id,upload_id,customer_name,customer_email,company,target_date,file_name,file_names,upload_file_names,upload_name",
    )
    .eq("id", quoteId)
    .maybeSingle<QuoteRow>();

  if (quoteError) {
    if (isMissingTableOrColumnError(quoteError)) {
      return { ok: false, error: "RFQ details are not available in this environment." };
    }
    console.error("[rfq outbound email] quote lookup failed", {
      quoteId,
      error: serializeSupabaseError(quoteError),
    });
    return { ok: false, error: "Unable to load this RFQ right now." };
  }

  if (!quote?.id) {
    return { ok: false, error: "RFQ not found." };
  }

  const fileLinksResult = await loadOutboundFileLinks(quoteId);
  if (!fileLinksResult.ok) {
    return { ok: false, error: fileLinksResult.error };
  }

  const explicitTitle = await loadQuoteTitle(quoteId);
  const uploadDetailResult = quote.upload_id
    ? await loadAdminUploadDetail(quote.upload_id)
    : null;
  const uploadMeta = uploadDetailResult?.ok ? uploadDetailResult.data : null;

  const uploadName = buildFullName(uploadMeta?.first_name ?? "", uploadMeta?.last_name ?? "");
  const customerName = pickFirst(uploadMeta?.name, uploadName, quote.customer_name);
  const customerCompany = pickFirst(uploadMeta?.company, quote.company);
  const customerEmail = pickFirst(uploadMeta?.email, quote.customer_email);
  const customerPhone = pickFirst(uploadMeta?.phone, null);

  const quoteTitle = explicitTitle ?? quote.id;

  const adapter = getAdapterForProvider(provider);
  if (!adapter) {
    return {
      ok: false,
      error: "No outbound email adapter is available for this provider.",
    };
  }

  const outbound = adapter.buildOutboundRfq({
    provider,
    quote: {
      id: quote.id,
      title: quoteTitle,
      process: uploadMeta?.manufacturing_process ?? null,
      quantity: uploadMeta?.quantity ?? null,
      targetDate: quote.target_date ?? null,
    },
    customer: {
      name: customerName,
      email: customerEmail,
      company: customerCompany,
      phone: customerPhone,
    },
    fileLinks: fileLinksResult.links,
  });

  if (!normalizeString(outbound.subject) || !normalizeString(outbound.body)) {
    return { ok: false, error: "Generated email content was incomplete." };
  }

  return { ok: true, subject: outbound.subject, body: outbound.body };
}
