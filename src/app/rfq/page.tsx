import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { QuickSpecsPanel } from "./QuickSpecsPanel";
import { getRfqOffers, isRfqOfferWithdrawn, summarizeRfqOffers } from "@/server/rfqs/offers";
import { normalizeQuoteStatus } from "@/server/quotes/status";
import { PublicOffersSection } from "./PublicOffersSection";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  searchParams?: Promise<SearchParams>;
};

function normalizeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] ?? "").trim();
  return typeof value === "string" ? value.trim() : "";
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function isValidIntakeKey(key: string): boolean {
  return /^[a-f0-9]{16,128}$/.test(key);
}

export default async function RfqStatusPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const quoteId = normalizeParam(sp.quote);
  const intakeKey = normalizeKey(normalizeParam(sp.key));

  if (!quoteId || !isValidIntakeKey(intakeKey)) {
    return (
      <main className="main-shell">
        <div className="mx-auto max-w-page px-4 sm:px-6 lg:px-8 py-16">
          <div className="mx-auto max-w-2xl space-y-4 text-center">
            <h1 className="text-2xl sm:text-3xl font-semibold text-ink">RFQ status</h1>
            <p className="text-sm text-ink-muted">This link is missing or invalid.</p>
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-full border border-slate-800 bg-slate-950/40 px-5 py-2 text-sm font-semibold text-ink hover:border-slate-700"
            >
              Back to homepage
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const quoteRes = await supabaseServer()
    .from("quotes")
    .select("id,upload_id,status,created_at,target_date")
    .eq("id", quoteId)
    .maybeSingle<{
      id: string;
      upload_id: string | null;
      status: string | null;
      created_at: string | null;
      target_date: string | null;
    }>();

  const quote = quoteRes.data?.id ? quoteRes.data : null;
  const uploadId = quote?.upload_id ?? null;

  let uploadOk = false;
  let primaryFileName: string | null = null;
  let uploadManufacturingProcess: string | null = null;
  let uploadQuantity: string | null = null;

  if (uploadId) {
    const uploadRes = await supabaseServer()
      .from("uploads")
      .select("id,intake_idempotency_key,file_name,manufacturing_process,quantity")
      .eq("id", uploadId)
      .eq("intake_idempotency_key", intakeKey)
      .maybeSingle<{
        id: string;
        intake_idempotency_key: string | null;
        file_name: string | null;
        manufacturing_process: string | null;
        quantity: string | null;
      }>();
    uploadOk = Boolean(uploadRes.data?.id);
    primaryFileName =
      typeof uploadRes.data?.file_name === "string" && uploadRes.data.file_name.trim()
        ? uploadRes.data.file_name.trim()
        : null;
    uploadManufacturingProcess =
      typeof uploadRes.data?.manufacturing_process === "string" &&
      uploadRes.data.manufacturing_process.trim().length > 0
        ? uploadRes.data.manufacturing_process.trim()
        : null;
    uploadQuantity =
      typeof uploadRes.data?.quantity === "string" && uploadRes.data.quantity.trim().length > 0
        ? uploadRes.data.quantity.trim()
        : null;
  }

  if (!quote || !uploadOk) {
    return (
      <main className="main-shell">
        <div className="mx-auto max-w-page px-4 sm:px-6 lg:px-8 py-16">
          <div className="mx-auto max-w-2xl space-y-4 text-center">
            <h1 className="text-2xl sm:text-3xl font-semibold text-ink">RFQ status</h1>
            <p className="text-sm text-ink-muted">
              We couldn’t find that RFQ. It may have expired, or the link may be incorrect.
            </p>
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-full border border-slate-800 bg-slate-950/40 px-5 py-2 text-sm font-semibold text-ink hover:border-slate-700"
            >
              Back to homepage
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const offers = await getRfqOffers(quote.id);
  const offersSummary = summarizeRfqOffers(offers);
  const offersCount = offersSummary.nonWithdrawn;
  const nonWithdrawnOffers = offers.filter((offer) => !isRfqOfferWithdrawn(offer.status));
  const normalizedStatus = normalizeQuoteStatus(quote.status ?? undefined);
  const initialOfferDtos = nonWithdrawnOffers.map((offer) => ({
    id: offer.id,
    providerName: offer.provider?.name ?? null,
    currency: offer.currency,
    totalPrice: offer.total_price,
    leadTimeDaysMin: offer.lead_time_days_min ?? null,
    leadTimeDaysMax: offer.lead_time_days_max ?? null,
    status: offer.status,
    receivedAt: offer.received_at ?? offer.created_at ?? null,
  }));

  const initialProcesses = (() => {
    const raw = (uploadManufacturingProcess ?? "").toLowerCase();
    const keys: Array<"cnc" | "3dp" | "sheet" | "injection"> = [];
    if (raw.includes("cnc")) keys.push("cnc");
    if (raw.includes("3d") || raw.includes("3dp") || raw.includes("printing") || raw.includes("additive")) {
      keys.push("3dp");
    }
    if (raw.includes("sheet")) keys.push("sheet");
    if (raw.includes("injection") || raw.includes("mold")) keys.push("injection");
    return Array.from(new Set(keys));
  })();

  const initialQuantity = (() => {
    if (!uploadQuantity) return null;
    const parsed = Number.parseInt(uploadQuantity, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  })();

  return (
    <main className="main-shell">
      <div className="mx-auto max-w-page px-4 sm:px-6 lg:px-8 py-16">
        <section className="mx-auto max-w-2xl space-y-6">
          <PublicOffersSection
            quoteId={quote.id}
            quoteStatus={quote.status ?? null}
            normalizedStatus={normalizedStatus}
            intakeKey={intakeKey}
            primaryFileName={primaryFileName}
            initialOffersCount={offersCount}
            initialOffers={initialOfferDtos}
          />

          <QuickSpecsPanel
            quoteId={quote.id}
            intakeKey={intakeKey}
            initial={{
              manufacturingProcesses: initialProcesses,
              targetDate: quote.target_date ?? null,
              quantity: initialQuantity,
            }}
          />
        </section>
      </div>
    </main>
  );
}

