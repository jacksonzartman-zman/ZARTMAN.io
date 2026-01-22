import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";
import { hasColumns, schemaGate } from "@/server/db/schemaContract";
import { isMissingTableOrColumnError, serializeSupabaseError } from "@/server/admin/logging";
import { getEligibleProvidersForQuote } from "@/server/providers/eligibility";
import { listProvidersWithContact } from "@/server/providers";
import { canonicalizeProcessTag, extractMaterialTagsFromText } from "@/lib/provider/discoveryTags";

const WARN_PREFIX = "[bench demand]";

type UnmetReason = "no_offers_after_contact" | "mismatch_only_available";

export type BenchDemandBucketRow = {
  key: string;
  label: string;
  unmetSearchCount: number;
  noOfferAfterContactCount: number;
  mismatchOnlyCount: number;
  exampleQuoteId: string | null;
  cta?: {
    process?: string;
    material?: string;
  };
};

export type BenchDemandWindow = {
  windowDays: number;
  supported: boolean;
  processes: BenchDemandBucketRow[];
  materials: BenchDemandBucketRow[];
  locations: BenchDemandBucketRow[];
  note?: string;
};

export type BenchDemandSummary = {
  supported: boolean;
  windows: {
    d7: BenchDemandWindow;
    d30: BenchDemandWindow;
  };
};

type QuoteRow = {
  id: string | null;
  created_at: string | null;
  upload_id: string | null;
  ship_to_state?: string | null;
  ship_to_country?: string | null;
  ship_to_postal_code?: string | null;
};

type UploadRow = {
  id: string;
  manufacturing_process?: string | null;
  shipping_postal_code?: string | null;
  rfq_reason?: string | null;
  notes?: string | null;
};

type DestinationCountRow = {
  rfq_id: string | null;
  status: string | null;
  dispatch_started_at?: string | null;
};

type OfferCountRow = { rfq_id: string | null };

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function windowSinceIso(days: number): string {
  const normalized = Math.max(1, Math.floor(days));
  return new Date(Date.now() - normalized * 24 * 60 * 60 * 1000).toISOString();
}

function bucketLocation(args: {
  shipToCountry?: string | null;
  shipToState?: string | null;
  shipToPostalCode?: string | null;
  uploadPostalCode?: string | null;
}): { key: string; label: string } | null {
  const country = normalizeText(args.shipToCountry)?.toUpperCase() ?? null;
  const state = normalizeText(args.shipToState)?.toUpperCase() ?? null;
  const postal = normalizeText(args.shipToPostalCode ?? args.uploadPostalCode)?.toUpperCase() ?? null;

  if (country && state) {
    return { key: `${country}-${state}`, label: `${country}-${state}` };
  }
  if (country) {
    return { key: country, label: country };
  }
  if (postal) {
    // Very coarse postal bucketing. Example: 941xx / SW1 / etc.
    const prefix = postal.replace(/\s+/g, "").slice(0, Math.min(3, postal.length));
    return { key: `postal:${prefix}`, label: `Postal ${prefix}…` };
  }
  return null;
}

function accumulate(
  map: Map<string, BenchDemandBucketRow>,
  args: {
    key: string;
    label: string;
    reason: UnmetReason;
    exampleQuoteId: string;
    cta?: BenchDemandBucketRow["cta"];
  },
) {
  const existing = map.get(args.key);
  if (!existing) {
    map.set(args.key, {
      key: args.key,
      label: args.label,
      unmetSearchCount: 1,
      noOfferAfterContactCount: args.reason === "no_offers_after_contact" ? 1 : 0,
      mismatchOnlyCount: args.reason === "mismatch_only_available" ? 1 : 0,
      exampleQuoteId: args.exampleQuoteId,
      cta: args.cta,
    });
    return;
  }
  existing.unmetSearchCount += 1;
  if (args.reason === "no_offers_after_contact") existing.noOfferAfterContactCount += 1;
  if (args.reason === "mismatch_only_available") existing.mismatchOnlyCount += 1;
}

function sortAndLimit(rows: BenchDemandBucketRow[], limit: number): BenchDemandBucketRow[] {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  return [...rows]
    .sort((a, b) => {
      const dc = b.unmetSearchCount - a.unmetSearchCount;
      if (dc !== 0) return dc;
      return a.label.localeCompare(b.label);
    })
    .slice(0, safeLimit);
}

export async function loadBenchDemandSummary(): Promise<BenchDemandSummary> {
  await requireAdminUser();

  const [destinationsSupported, offersSupported, quotesSupported, uploadsSupported] =
    await Promise.all([
      schemaGate({
        enabled: true,
        relation: "rfq_destinations",
        requiredColumns: ["rfq_id", "status", "created_at"],
        warnPrefix: WARN_PREFIX,
        warnKey: "bench_demand:rfq_destinations",
      }),
      schemaGate({
        enabled: true,
        relation: "rfq_offers",
        requiredColumns: ["rfq_id", "created_at"],
        warnPrefix: WARN_PREFIX,
        warnKey: "bench_demand:rfq_offers",
      }),
      schemaGate({
        enabled: true,
        relation: "quotes",
        requiredColumns: ["id", "created_at", "upload_id"],
        warnPrefix: WARN_PREFIX,
        warnKey: "bench_demand:quotes",
      }),
      schemaGate({
        enabled: true,
        relation: "uploads",
        requiredColumns: ["id", "manufacturing_process"],
        warnPrefix: WARN_PREFIX,
        warnKey: "bench_demand:uploads",
      }),
    ]);

  const supported = destinationsSupported && offersSupported && quotesSupported && uploadsSupported;

  const emptyWindow = (days: number, note?: string): BenchDemandWindow => ({
    windowDays: days,
    supported: false,
    processes: [],
    materials: [],
    locations: [],
    note,
  });

  if (!supported) {
    return {
      supported: false,
      windows: {
        d7: emptyWindow(7, "Bench demand signals are unavailable on this schema."),
        d30: emptyWindow(30, "Bench demand signals are unavailable on this schema."),
      },
    };
  }

  // Optional columns (fail-soft).
  const [supportsDispatchStartedAt, supportsShipToState, supportsShipToCountry, supportsShipToPostalCode] =
    await Promise.all([
      hasColumns("rfq_destinations", ["dispatch_started_at"]),
      hasColumns("quotes", ["ship_to_state"]),
      hasColumns("quotes", ["ship_to_country"]),
      hasColumns("quotes", ["ship_to_postal_code"]),
    ]);

  // Pull the last 30d of searches and derive 7d as a subset (keeps queries bounded).
  const since30 = windowSinceIso(30);
  const since7 = windowSinceIso(7);

  const quoteSelect = [
    "id",
    "created_at",
    "upload_id",
    supportsShipToState ? "ship_to_state" : null,
    supportsShipToCountry ? "ship_to_country" : null,
    supportsShipToPostalCode ? "ship_to_postal_code" : null,
  ]
    .filter(Boolean)
    .join(",");

  let quotes30: QuoteRow[] = [];
  try {
    const { data, error } = await supabaseServer
      .from("quotes")
      .select(quoteSelect)
      .gte("created_at", since30)
      .order("created_at", { ascending: false })
      .limit(2000)
      .returns<QuoteRow[]>();
    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return {
          supported: false,
          windows: {
            d7: emptyWindow(7, "Bench demand signals are unavailable on this schema."),
            d30: emptyWindow(30, "Bench demand signals are unavailable on this schema."),
          },
        };
      }
      console.warn("[bench demand] quotes query failed", { error: serializeSupabaseError(error) });
      return {
        supported: false,
        windows: {
          d7: emptyWindow(7, "Unable to load bench demand signals right now."),
          d30: emptyWindow(30, "Unable to load bench demand signals right now."),
        },
      };
    }
    quotes30 = Array.isArray(data) ? data : [];
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return {
        supported: false,
        windows: {
          d7: emptyWindow(7, "Bench demand signals are unavailable on this schema."),
          d30: emptyWindow(30, "Bench demand signals are unavailable on this schema."),
        },
      };
    }
    console.warn("[bench demand] quotes query crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
    return {
      supported: false,
      windows: {
        d7: emptyWindow(7, "Unable to load bench demand signals right now."),
        d30: emptyWindow(30, "Unable to load bench demand signals right now."),
      },
    };
  }

  const quoteIds30 = quotes30.map((q) => normalizeId(q.id)).filter(Boolean);
  const quoteIds7 = quotes30
    .filter((q) => {
      const createdAt = normalizeText(q.created_at);
      return createdAt ? createdAt >= since7 : false;
    })
    .map((q) => normalizeId(q.id))
    .filter(Boolean);

  const uploadIds = Array.from(
    new Set(quotes30.map((q) => normalizeId(q.upload_id)).filter(Boolean)),
  );

  const uploadById = new Map<string, UploadRow>();
  if (uploadIds.length > 0) {
    try {
      const { data, error } = await supabaseServer
        .from("uploads")
        .select("id,manufacturing_process,shipping_postal_code,rfq_reason,notes")
        .in("id", uploadIds)
        .returns<UploadRow[]>();
      if (!error) {
        for (const row of Array.isArray(data) ? data : []) {
          const id = normalizeId(row?.id);
          if (!id) continue;
          uploadById.set(id, row);
        }
      }
    } catch {
      // fail-soft (materials/process will just be missing).
    }
  }

  const destinationSelect = [
    "rfq_id",
    "status",
    supportsDispatchStartedAt ? "dispatch_started_at" : null,
  ]
    .filter(Boolean)
    .join(",");

  const contactedCountsByQuoteId = new Map<string, number>();
  const offerCountsByQuoteId = new Map<string, number>();

  for (const id of quoteIds30) {
    contactedCountsByQuoteId.set(id, 0);
    offerCountsByQuoteId.set(id, 0);
  }

  try {
    const { data, error } = await supabaseServer
      .from("rfq_destinations")
      .select(destinationSelect)
      .in("rfq_id", quoteIds30)
      .returns<DestinationCountRow[]>();
    if (!error) {
      for (const row of Array.isArray(data) ? data : []) {
        const quoteId = normalizeId(row?.rfq_id);
        if (!quoteId) continue;
        const status = normalizeId(row?.status).toLowerCase();
        const contacted =
          Boolean(row?.dispatch_started_at) ||
          (status && status !== "draft"); // best-effort (draft isn't contacted)
        if (!contacted) continue;
        contactedCountsByQuoteId.set(quoteId, (contactedCountsByQuoteId.get(quoteId) ?? 0) + 1);
      }
    }
  } catch {
    // fail-soft
  }

  try {
    const { data, error } = await supabaseServer
      .from("rfq_offers")
      .select("rfq_id")
      .in("rfq_id", quoteIds30)
      .returns<OfferCountRow[]>();
    if (!error) {
      for (const row of Array.isArray(data) ? data : []) {
        const quoteId = normalizeId(row?.rfq_id);
        if (!quoteId) continue;
        offerCountsByQuoteId.set(quoteId, (offerCountsByQuoteId.get(quoteId) ?? 0) + 1);
      }
    }
  } catch {
    // fail-soft
  }

  // Providers are loaded once; eligibility is computed per-quote (bounded by quote limit above).
  const providerResult = await listProvidersWithContact();
  const providers = providerResult.providers;
  const emailColumn = providerResult.emailColumn;

  const buildWindow = async (days: number, quoteIds: string[]): Promise<BenchDemandWindow> => {
    const processes = new Map<string, BenchDemandBucketRow>();
    const materials = new Map<string, BenchDemandBucketRow>();
    const locations = new Map<string, BenchDemandBucketRow>();

    const quoteById = new Map<string, QuoteRow>();
    for (const q of quotes30) {
      const id = normalizeId(q.id);
      if (id) quoteById.set(id, q);
    }

    // Small cap so we don't accidentally do too much per-render.
    const ids = quoteIds.slice(0, 1000);

    for (const quoteId of ids) {
      const quote = quoteById.get(quoteId) ?? null;
      if (!quote) continue;

      const contactedCount = contactedCountsByQuoteId.get(quoteId) ?? 0;
      const offerCount = offerCountsByQuoteId.get(quoteId) ?? 0;

      const uploadId = normalizeId(quote.upload_id);
      const upload = uploadId ? uploadById.get(uploadId) ?? null : null;
      const rawProcess = normalizeText(upload?.manufacturing_process) ?? null;
      const canonicalProcess = canonicalizeProcessTag(rawProcess);

      const materialText = [upload?.rfq_reason ?? "", upload?.notes ?? ""].join("\n");
      const extractedMaterials = extractMaterialTagsFromText(materialText);

      const locationBucket = bucketLocation({
        shipToCountry: quote.ship_to_country ?? null,
        shipToState: quote.ship_to_state ?? null,
        shipToPostalCode: quote.ship_to_postal_code ?? null,
        uploadPostalCode: upload?.shipping_postal_code ?? null,
      });

      const noOfferAfterContact = contactedCount > 0 && offerCount === 0;

      // "Mismatch-only available" = we have routing signals, but eligibility returns zero matches.
      let mismatchOnly = false;
      try {
        const criteria = {
          process: rawProcess,
          shipToState: quote.ship_to_state ?? null,
          shipToCountry: quote.ship_to_country ?? null,
          shipToPostalCode: quote.ship_to_postal_code ?? upload?.shipping_postal_code ?? null,
          quantity: null,
        };
        const eligibility = await getEligibleProvidersForQuote(quoteId, criteria, {
          providers,
          emailColumn,
        });
        const hasSignals = Boolean(
          eligibility.criteria.process || eligibility.criteria.shipToCountry || eligibility.criteria.shipToState,
        );
        mismatchOnly = hasSignals && eligibility.eligibleProviderIds.length === 0 && providers.length > 0;
      } catch {
        mismatchOnly = false;
      }

      const unmetReason: UnmetReason | null = noOfferAfterContact
        ? "no_offers_after_contact"
        : mismatchOnly
          ? "mismatch_only_available"
          : null;

      if (!unmetReason) continue;

      if (canonicalProcess) {
        const key = canonicalProcess.toLowerCase();
        const topMaterial = extractedMaterials[0]?.toString() ?? undefined;
        accumulate(processes, {
          key,
          label: canonicalProcess,
          reason: unmetReason,
          exampleQuoteId: quoteId,
          cta: {
            process: canonicalProcess,
            material: topMaterial,
          },
        });
      }

      for (const tag of extractedMaterials) {
        accumulate(materials, {
          key: tag.toLowerCase(),
          label: tag,
          reason: unmetReason,
          exampleQuoteId: quoteId,
          cta: { material: tag },
        });
      }

      if (locationBucket) {
        accumulate(locations, {
          key: locationBucket.key,
          label: locationBucket.label,
          reason: unmetReason,
          exampleQuoteId: quoteId,
        });
      }
    }

    return {
      windowDays: days,
      supported: true,
      processes: sortAndLimit(Array.from(processes.values()), 10),
      materials: sortAndLimit(Array.from(materials.values()), 10),
      locations: sortAndLimit(Array.from(locations.values()), 10),
      note: ids.length < quoteIds.length ? "Results truncated for performance." : undefined,
    };
  };

  const [d7, d30] = await Promise.all([
    buildWindow(7, quoteIds7),
    buildWindow(30, quoteIds30),
  ]);

  return {
    supported: true,
    windows: { d7, d30 },
  };
}

