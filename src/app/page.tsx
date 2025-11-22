import Link from "next/link";
import clsx from "clsx";
import EarlyAccessForm from "@/components/EarlyAccessForm";
import { primaryCtaClasses } from "@/lib/ctas";

const HERO_PREVIEW_ROWS = [
  {
    id: "QT-1082",
    customer: "Atlas Motion",
    file: "stanchion-plate.step",
    status: "In review",
    detail: "Ops • Supabase",
  },
  {
    id: "QT-1081",
    customer: "Nomad Hydraulics",
    file: "valve-body.stp",
    status: "Quoted",
    detail: "Sales • Supabase",
  },
  {
    id: "QT-1079",
    customer: "Bright Robotics",
    file: "armature-v6.sldprt",
    status: "Submitted",
    detail: "Uploads • Supabase",
  },
];

export default function HomePage() {
  return (
    <main className="main-shell">
      <div className="mx-auto max-w-page px-4 sm:px-6 lg:px-8 py-16 sm:py-20 space-y-16">
        {/* HERO */}
        <section className="grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start">
          <div className="space-y-6">
            <div className="badge-soft">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              <span>Built for quoting &amp; AM teams</span>
            </div>

            <div className="space-y-4">
              <h1 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-ink">
                Zartman.io — an admin cockpit for your quoting workflow
              </h1>
              <p className="max-w-copy text-sm sm:text-base text-ink-muted">
                One dark-mode hub that shows uploads, quote status, pricing, and
                target dates — all synced from Supabase. Keep sales, AM, and ops
                aligned without duct-taped spreadsheets.
              </p>
            </div>

            <ul className="grid gap-3 text-sm text-ink-muted sm:grid-cols-2">
              <li className="surface-card p-3 shadow-lift-sm">
                Live dashboards for uploads + quotes, with filters and status
                pills that mirror your admin view.
              </li>
              <li className="surface-card p-3 shadow-lift-sm">
                Server actions + Supabase service role keep edits in sync,
                including price, currency, target date, and notes.
              </li>
            </ul>

              <EarlyAccessForm />

              <div className="flex flex-wrap items-center gap-4">
                <Link href="/quote" className={primaryCtaClasses}>
                  Get a quote
                </Link>
                <Link
                  href="#how-it-works"
                  className="inline-flex items-center justify-center rounded-pill border border-line-subtle px-6 py-2 text-sm font-semibold text-ink transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  See how it works
                </Link>
              </div>
          </div>

          {/* Right side: admin preview + intake */}
          <div className="space-y-4 lg:pl-4">
            <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-5 shadow-lift-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-ink">
                    Quotes dashboard preview
                  </p>
                  <p className="text-xs text-ink-muted">
                    Supabase view · status filters live
                  </p>
                </div>
                <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
                  /admin/quotes
                </span>
              </div>
              <div className="mt-4 space-y-3">
                {HERO_PREVIEW_ROWS.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-2xl border border-slate-900/70 bg-slate-900/40 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-ink">
                          {row.customer}
                        </p>
                        <p className="text-xs text-ink-muted">{row.file}</p>
                      </div>
                      <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-emerald-300">
                        {row.status}
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] uppercase tracking-wide text-ink-soft">
                      {row.detail}
                    </p>
                  </div>
                ))}
              </div>
            </div>
                <div className="rounded-3xl border border-slate-800 bg-slate-950/40 p-5 shadow-lift-sm space-y-4">
                <p className="text-sm font-semibold text-ink">
                  CAD intake lives on /quote
                </p>
                <p className="text-sm text-ink-muted">
                  STEP, IGES, STL, SolidWorks &amp; zipped assemblies. Uploads land in
                  Supabase storage and show up instantly in the admin dashboard.
                </p>
                <ul className="space-y-2 text-sm text-ink-soft">
                  <li>• Secure storage with automatic filename sanitizing.</li>
                  <li>• Status tracking that mirrors the admin cockpit.</li>
                  <li>• DFM notes + pricing threads kept in one place.</li>
                </ul>
                <Link
                  href="/quote"
                  className={clsx(primaryCtaClasses, "w-full")}
                >
                    Get a quote
                  </Link>
              </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
          <section id="how-it-works" className="space-y-6 scroll-mt-24">
          <header className="space-y-2">
            <h2 className="text-lg sm:text-xl font-semibold text-ink">
              How it works
            </h2>
            <p className="max-w-copy text-sm text-ink-muted">
              You send one file with a bit of context. We translate that into a
              realistic path to parts-in-hand — with options, not fluff.
            </p>
          </header>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="surface-card p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                1. Upload
              </div>
              <p className="text-sm text-ink-soft">
                Drop in your CAD and a short note about volumes, timelines, and
                what &quot;good&quot; looks like for you.
              </p>
            </div>
            <div className="surface-card p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                2. Review
              </div>
              <p className="text-sm text-ink-soft">
                We review manufacturability, flag risk areas, and line up
                realistic options — not fantasy lead times.
              </p>
            </div>
            <div className="surface-card p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                3. Decide
              </div>
              <p className="text-sm text-ink-soft">
                You get an honest, actionable plan: pricing signals, lead times,
                and clear next steps so you can move.
              </p>
            </div>
          </div>
        </section>

        {/* WHY THIS EXISTS */}
        <section className="space-y-4 max-w-copy">
          <h2 className="text-lg sm:text-xl font-semibold text-ink">
            Why this exists
          </h2>
          <p className="text-sm sm:text-base text-ink-soft">
            Modern manufacturing workflows are fragmented: one portal for
            quotes, one inbox thread for DFM, one spreadsheet for suppliers.
            Zartman.io is a single front door for the messy part in the middle —
            getting from CAD to parts without losing context or time.
          </p>
          <p className="text-sm sm:text-base text-ink-muted">
            This isn&apos;t about replacing your suppliers. It&apos;s about
            giving you a simple way to point at a file and say,
            &quot;Here&apos;s what I&apos;m trying to do. Help me make it
            real.&quot;
          </p>
        </section>

        {/* FOOTER */}
        <footer className="border-t border-line-subtle pt-6 text-xs text-ink-muted flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <p>
            Built by Zartman. Informed by too many manufacturing war stories to
            count.
          </p>
          <p className="text-[11px] text-ink-muted">
            Early experimental version. If you&apos;re curious, email or DM and
            we&apos;ll talk shop.
          </p>
        </footer>
      </div>
    </main>
  );
}
