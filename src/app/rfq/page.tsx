import Link from "next/link";
import clsx from "clsx";
import { supabaseServer } from "@/lib/supabaseServer";
import { QuickSpecsPanel } from "./QuickSpecsPanel";

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

  const steps = [
    { key: "uploading", label: "Uploading" },
    { key: "processing", label: "Processing" },
    { key: "offers", label: "Offers coming" },
  ] as const;

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
          <header className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-ink-soft">
              RFQ status
            </p>
            <h1 className="text-2xl sm:text-3xl font-semibold text-ink">
              Offers are on the way
            </h1>
            <p className="text-sm text-ink-muted">
              We’re processing your files and routing your RFQ to manufacturing providers.
            </p>
          </header>

          <div className="rounded-3xl border border-slate-900/60 bg-slate-950/55 p-6 shadow-[0_20px_60px_rgba(2,6,23,0.45)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-ink">Quote ID</p>
                <p className="text-xs text-ink-soft">{quote.id}</p>
              </div>
              <div className="text-xs font-semibold text-ink-soft">
                Status: <span className="text-ink">{(quote.status ?? "Submitted").trim() || "Submitted"}</span>
              </div>
            </div>

            {primaryFileName ? (
              <p className="mt-3 text-xs text-ink-soft">
                Primary file: <span className="font-semibold text-ink">{primaryFileName}</span>
              </p>
            ) : null}

            <ol className="mt-5 grid gap-3 sm:grid-cols-3">
              {steps.map((s, idx) => (
                <li
                  key={s.key}
                  className={clsx(
                    "rounded-2xl border px-4 py-4",
                    idx === steps.length - 1
                      ? "border-emerald-400/30 bg-emerald-500/10"
                      : "border-slate-900/60 bg-slate-950/30",
                  )}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ink-soft">
                    Step {idx + 1}
                  </p>
                  <p className={clsx("mt-2 text-sm font-semibold", idx === steps.length - 1 ? "text-emerald-100" : "text-ink")}>
                    {s.label}
                  </p>
                  <p className="mt-1 text-xs text-ink-soft">
                    {s.key === "uploading"
                      ? "Files received and secured."
                      : s.key === "processing"
                        ? "Extracting parts and preparing quotes."
                        : "We’ll surface offers as providers respond."}
                  </p>
                </li>
              ))}
            </ol>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <Link
                href="/"
                className="rounded-full border border-slate-800 bg-slate-950/40 px-4 py-2 text-xs font-semibold text-ink transition hover:border-slate-700"
              >
                Upload another RFQ
              </Link>
              <p className="text-xs text-ink-soft">
                Keep this page open or bookmark it to check back.
              </p>
            </div>
          </div>

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

