import { supabaseServer } from "@/lib/supabaseServer";
import { formatCurrency } from "@/lib/formatCurrency";
import { formatShortId } from "@/lib/awards";
import { getRfqOffers, type RfqOffer } from "@/server/rfqs/offers";
import { isMissingTableOrColumnError, serializeSupabaseError } from "@/server/admin/logging";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

type AwardEmailResult =
  | { ok: true; subject: string; body: string }
  | { ok: false; error: string };

type QuoteSelectionRow = Record<string, unknown>;

type RawFileRow = {
  id?: string | null;
  filename?: string | null;
  bucket_id?: string | null;
  storage_bucket_id?: string | null;
  storage_path?: string | null;
  file_path?: string | null;
  path?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type FileLoadResult =
  | { ok: true; rows: RawFileRow[] }
  | { ok: false; missing: true }
  | { ok: false; missing: false; error: string };

type OutboundFileLink = {
  label: string;
  url: string;
  createdAtMs: number;
};

const AWARD_EMAIL_GENERIC_ERROR =
  "We could not generate the award email right now. Please try again.";

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeId(value: unknown): string {
  return normalizeString(value);
}

function normalizeOptionalText(value: unknown): string | null {
  const trimmed = normalizeString(value);
  return trimmed.length > 0 ? trimmed : null;
}

function pickFirst(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatOfferPrice(offer: RfqOffer | null): string {
  if (!offer) return "Pending";
  const total = normalizeNumber(offer.total_price);
  if (typeof total === "number") {
    return formatCurrency(total, offer.currency ?? "USD");
  }
  const unit = normalizeNumber(offer.unit_price);
  if (typeof unit === "number") {
    return `${formatCurrency(unit, offer.currency ?? "USD")} unit`;
  }
  if (typeof offer.total_price === "string" && offer.total_price.trim()) {
    return offer.total_price.trim();
  }
  return "Pending";
}

function formatOfferLeadTime(offer: RfqOffer | null): string {
  if (!offer) return "Pending";
  const minDays = offer.lead_time_days_min;
  const maxDays = offer.lead_time_days_max;
  const minValue = typeof minDays === "number" && Number.isFinite(minDays) ? minDays : null;
  const maxValue = typeof maxDays === "number" && Number.isFinite(maxDays) ? maxDays : null;
  if (minValue !== null && maxValue !== null) {
    if (minValue === maxValue) {
      return `${minValue} day${minValue === 1 ? "" : "s"}`;
    }
    return `${minValue}-${maxValue} days`;
  }
  if (minValue !== null) return `${minValue}+ days`;
  if (maxValue !== null) return `Up to ${maxValue} days`;
  return "Pending";
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

function parseTimestampMs(value: unknown): number {
  if (typeof value !== "string" || !value.trim()) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildBulletLines(label: string, value: string | null, fallback: string): string[] {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return [`- ${label}: ${fallback}`];
  }
  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return [`- ${label}: ${fallback}`];
  }
  if (lines.length === 1) {
    return [`- ${label}: ${lines[0]}`];
  }
  return [`- ${label}: ${lines[0]}`, ...lines.slice(1).map((line) => `  ${line}`)];
}

async function loadFileRowsFromRelation(
  relation: "files_valid_compat" | "files_valid" | "files",
  quoteId: string,
): Promise<FileLoadResult> {
  try {
    const { data, error } = await supabaseServer()
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
        error: "Unable to load file metadata.",
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
      error: "Unable to load file metadata.",
    };
  }
}

async function loadLatestFileLinks(quoteId: string): Promise<
  | { ok: true; links: OutboundFileLink[] }
  | { ok: false; error: string; links: OutboundFileLink[] }
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
      return { ok: false, error: result.error, links: [] };
    }

    const seen = new Set<string>();
    const links: OutboundFileLink[] = [];
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

      const createdAtMs =
        parseTimestampMs(row.created_at) || parseTimestampMs(row.updated_at);
      links.push({
        label: filename,
        url: buildDownloadUrl(bucket, path, filename),
        createdAtMs,
      });
    }

    links.sort((a, b) => b.createdAtMs - a.createdAtMs || a.label.localeCompare(b.label));

    return { ok: true, links };
  }

  return {
    ok: false,
    error: "File metadata is unavailable in this environment.",
    links: [],
  };
}

async function loadProviderName(providerId: string): Promise<string | null> {
  if (!providerId) return null;
  try {
    const { data, error } = await supabaseServer()
      .from("providers")
      .select("name")
      .eq("id", providerId)
      .maybeSingle<{ name: string | null }>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return null;
      }
      console.warn("[award email] provider lookup failed", {
        providerId,
        error: serializeSupabaseError(error),
      });
      return null;
    }

    const name = normalizeString(data?.name);
    return name || null;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return null;
    }
    console.warn("[award email] provider lookup crashed", {
      providerId,
      error: serializeSupabaseError(error) ?? error,
    });
    return null;
  }
}

async function loadQuoteFileName(quoteId: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseServer()
      .from("quotes_with_uploads")
      .select("file_name,file_names,upload_file_names")
      .eq("id", quoteId)
      .maybeSingle<{
        file_name: string | null;
        file_names: string[] | null;
        upload_file_names: string[] | null;
      }>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return null;
      }
      console.warn("[award email] quote file lookup failed", {
        quoteId,
        error: serializeSupabaseError(error),
      });
      return null;
    }

    const orderedNames = [
      ...(Array.isArray(data?.file_names) ? data.file_names : []),
      ...(Array.isArray(data?.upload_file_names) ? data.upload_file_names : []),
    ]
      .map((name) => normalizeString(name))
      .filter(Boolean);

    const first = orderedNames[0] ?? normalizeString(data?.file_name);
    return first || null;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return null;
    }
    console.warn("[award email] quote file lookup crashed", {
      quoteId,
      error: serializeSupabaseError(error) ?? error,
    });
    return null;
  }
}

export async function buildAwardEmail(args: { quoteId: string }): Promise<AwardEmailResult> {
  const quoteId = normalizeId(args.quoteId);
  if (!quoteId) {
    return { ok: false, error: "Missing search request identifier." };
  }

  try {
    const { data: quote, error: quoteError } = await supabaseServer()
      .from("quotes")
      .select("*")
      .eq("id", quoteId)
      .maybeSingle<QuoteSelectionRow>();

    if (quoteError) {
      if (isMissingTableOrColumnError(quoteError)) {
        return {
          ok: false,
          error: "Quote details are not available in this environment.",
        };
      }
      console.error("[award email] quote lookup failed", {
        quoteId,
        error: serializeSupabaseError(quoteError),
      });
      return { ok: false, error: AWARD_EMAIL_GENERIC_ERROR };
    }

    if (!quote) {
      return { ok: false, error: "Search request not found." };
    }

    const selectedOfferId = normalizeId(quote?.selected_offer_id);
    if (!selectedOfferId) {
      return { ok: false, error: "No selected offer is recorded for this search request yet." };
    }

    const selectedProviderId = normalizeId(quote?.selected_provider_id);
    const offers = await getRfqOffers(quoteId);
    const selectedOffer = offers.find((offer) => offer.id === selectedOfferId) ?? null;

    const providerId = normalizeId(selectedOffer?.provider_id) || selectedProviderId;
    const providerName =
      normalizeString(selectedOffer?.provider?.name) ||
      (providerId ? await loadProviderName(providerId) : null);
    const providerLabel = providerName || "Selected provider";
    const greetingName = providerName || "there";

    const priceLabel = formatOfferPrice(selectedOffer);
    const leadTimeLabel = formatOfferLeadTime(selectedOffer);
    const assumptions = normalizeOptionalText(selectedOffer?.assumptions) ?? "None noted";
    const dfmFlags =
      Array.isArray(selectedOffer?.quality_risk_flags) && selectedOffer.quality_risk_flags.length > 0
        ? selectedOffer.quality_risk_flags.join(", ")
        : "None noted";

    const poNumber = normalizeOptionalText(quote?.po_number);
    const shipTo = normalizeOptionalText(quote?.ship_to);
    const inspectionRequirements = normalizeOptionalText(quote?.inspection_requirements);

    const [fileLinksResult, fileName] = await Promise.all([
      loadLatestFileLinks(quoteId),
      loadQuoteFileName(quoteId),
    ]);

    const projectLabel = pickFirst(
      normalizeOptionalText(quote?.title),
      fileName,
      formatShortId(quoteId),
    );
    const shortId = formatShortId(quoteId);
    const subjectBase =
      projectLabel && projectLabel !== shortId ? `${projectLabel} (${shortId})` : shortId;
    const subject = `Award: ${subjectBase}`;

    const MAX_FILE_LINKS = 8;
    const sortedLinks = fileLinksResult.ok ? fileLinksResult.links : [];
    const trimmedLinks = sortedLinks.slice(0, MAX_FILE_LINKS);
    const remainingCount = sortedLinks.length - trimmedLinks.length;

    const fileLines =
      trimmedLinks.length > 0
        ? trimmedLinks.map((link) => `- ${link.label}: ${link.url}`)
        : [
            fileLinksResult.ok
              ? "- No file links available."
              : "- File links unavailable. Use the portal to download.",
          ];
    if (remainingCount > 0) {
      fileLines.push(`- ${remainingCount} more file(s) available in the portal.`);
    }

    const lines = [
      `Hi ${greetingName},`,
      "",
      `You're the selected provider for search request ${subjectBase}. Below is the confirmed award pack.`,
      "",
      "Selected offer summary",
      `- Provider: ${providerLabel}`,
      `- Price: ${priceLabel}`,
      `- Lead time: ${leadTimeLabel}`,
      ...buildBulletLines("Assumptions", assumptions, "None noted"),
      "",
      "Confirmed fulfillment details",
      ...buildBulletLines("PO number", poNumber, "Not provided"),
      ...buildBulletLines("Ship-to", shipTo, "Not provided"),
      ...buildBulletLines("Inspection requirements", inspectionRequirements, "Not provided"),
      "",
      "Latest files",
      ...fileLines,
      "",
      "Next steps",
      "Please confirm receipt, share your production ETA, and flag any DFM concerns.",
      `DFM flags: ${dfmFlags}`,
      "",
      "Thanks,",
      "Zartman.io",
    ];

    return { ok: true, subject, body: lines.join("\n") };
  } catch (error) {
    console.error("[award email] crashed", {
      quoteId,
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, error: AWARD_EMAIL_GENERIC_ERROR };
  }
}
