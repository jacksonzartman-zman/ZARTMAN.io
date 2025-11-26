import Link from "next/link";
import EarlyAccessForm from "@/components/EarlyAccessForm";
import { primaryCtaClasses } from "@/lib/ctas";

export default function HomePage() {
  return (
    <main className="main-shell">
      <div className="mx-auto max-w-page px-4 sm:px-6 lg:px-8 py-16 sm:py-20 space-y-16">
        {/* HERO */}
        <section className="grid gap-10 lg:grid-cols-2 items-start">
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
            <p className="text-xs text-ink-soft">
              CAD uploads still land on{" "}
              <Link href="/quote" className="font-semibold text-ink">
                /quote
              </Link>{" "}
              and sync straight into the cockpit in seconds.
            </p>
          </div>

          <div className="space-y-6 lg:pl-4">
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

            <div id="early-access">
              <EarlyAccessForm />
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

      </div>
    </main>
  );
}
