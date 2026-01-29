import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { QuickSpecsPanel } from "./QuickSpecsPanel";
import { getRfqOffers, isRfqOfferWithdrawn, summarizeRfqOffers } from "@/server/rfqs/offers";
import {
  filterOffersByCustomerExclusions,
  loadCustomerExclusions,
} from "@/server/customers/exclusions";
import { normalizeQuoteStatus } from "@/server/quotes/status";
import { PublicOffersSection } from "./PublicOffersSection";
import { getServerAuthUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";

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

type ClaimState =
  | "anon"
  | "no_customer_profile"
  | "can_claim"
  | "already_saved_to_you"
  | "already_saved_elsewhere";

type ProcessKey = "cnc" | "3dp" | "sheet" | "injection";

function parseManufacturingProcessKeys(input: string | null): ProcessKey[] {
  if (!input) return [];
  const raw = input.trim();
  if (!raw) return [];

  // Preferred (new) format: comma-separated process keys, e.g. "cnc,3dp"
  const csvKeys = raw
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter((v): v is ProcessKey => v === "cnc" || v === "3dp" || v === "sheet" || v === "injection");
  if (csvKeys.length > 0) {
    return Array.from(new Set(csvKeys));
  }

  // Backfill (legacy) format: human labels stored in the same column.
  const legacy = raw.toLowerCase();
  const keys: ProcessKey[] = [];
  if (legacy.includes("cnc")) keys.push("cnc");
  if (legacy.includes("3d") || legacy.includes("3dp") || legacy.includes("printing") || legacy.includes("additive")) {
    keys.push("3dp");
  }
  if (legacy.includes("sheet")) keys.push("sheet");
  if (legacy.includes("injection") || legacy.includes("mold")) keys.push("injection");
  return Array.from(new Set(keys));
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
    .select("id,upload_id,status,created_at,target_date,customer_id")
    .eq("id", quoteId)
    .maybeSingle<{
      id: string;
      upload_id: string | null;
      status: string | null;
      created_at: string | null;
      target_date: string | null;
      customer_id: string | null;
    }>();

  const quote = quoteRes.data?.id ? quoteRes.data : null;
  const uploadId = quote?.upload_id ?? null;

  let uploadOk = false;
  let primaryFileName: string | null = null;
  let uploadManufacturingProcess: string | null = null;
  let uploadQuantity: string | null = null;
  let projectStatus: string | null = null;

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

  const { user } = await getServerAuthUser({ quiet: true });
  const viewerCustomer = user ? await getCustomerByUserId(user.id) : null;
  const viewerCustomerId = viewerCustomer?.id ?? null;
  const quoteCustomerId = typeof quote.customer_id === "string" ? quote.customer_id : null;

  const claimState: ClaimState = (() => {
    if (!user) return "anon";
    if (!viewerCustomerId) return "no_customer_profile";
    if (!quoteCustomerId) return "can_claim";
    if (quoteCustomerId === viewerCustomerId) return "already_saved_to_you";
    return "already_saved_elsewhere";
  })();

  const offersRaw = await getRfqOffers(quote.id);
  const offers =
    quoteCustomerId && offersRaw.length > 0
      ? filterOffersByCustomerExclusions(
          offersRaw,
          await loadCustomerExclusions(quoteCustomerId),
        )
      : offersRaw;
  const offersSummary = summarizeRfqOffers(offers);
  const offersCount = offersSummary.nonWithdrawn;
  const nonWithdrawnOffers = offers.filter((offer) => !isRfqOfferWithdrawn(offer.status));
  const normalizedStatus = normalizeQuoteStatus(quote.status ?? undefined);

  // Optional: if a project has been created after award, use it to show "In progress".
  // Fail-soft if schema is missing or query errors.
  try {
    const projectRes = await supabaseServer()
      .from("quote_projects")
      .select("status")
      .eq("quote_id", quote.id)
      .maybeSingle<{ status: string | null }>();
    if (!projectRes.error && projectRes.data) {
      projectStatus =
        typeof projectRes.data.status === "string" && projectRes.data.status.trim()
          ? projectRes.data.status.trim()
          : null;
    }
  } catch {
    // ignore
  }
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

  const initialProcesses = parseManufacturingProcessKeys(uploadManufacturingProcess);

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
            initialProjectStatus={projectStatus}
            claimState={claimState}
            loginNextPath={`/rfq?quote=${encodeURIComponent(quote.id)}&key=${encodeURIComponent(
              intakeKey,
            )}`}
          />

          <QuickSpecsPanel
            quoteId={quote.id}
            intakeKey={intakeKey}
            primaryFileName={primaryFileName}
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

