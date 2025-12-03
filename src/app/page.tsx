import Link from "next/link";
import EarlyAccessForm from "@/components/EarlyAccessForm";
import { primaryCtaClasses } from "@/lib/ctas";
import PortalCard from "@/app/(portals)/PortalCard";

const TRUST_SIGNALS = [
  "Built by manufacturing sales leaders",
  "Files stay private and secure",
  "No blast emails or marketplace spam",
];

const HOW_IT_WORKS_STEPS = [
  {
    title: "1. Upload your RFQ",
    description:
      "Drop a CAD file or drawing, add a few details, and choose your process and quantities.",
  },
  {
    title: "2. We route to vetted suppliers",
    description:
      "We match your RFQ with a small bench of trusted shops—no auctions, no race-to-the-bottom blast lists.",
  },
  {
    title: "3. You review quotes and award a winner",
    description:
      "Compare pricing and lead times side-by-side in your workspace, then select a winner to kick off the project.",
  },
];

export default function HomePage() {
  return (
    <main className="main-shell">
      <div className="mx-auto max-w-page px-4 sm:px-6 lg:px-8 py-16 sm:py-20 space-y-16">
        {/* HERO */}
        <section className="mx-auto max-w-4xl space-y-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-ink-soft">
            RFQs without the chaos
          </p>
          <div className="space-y-5">
            <h1 className="text-4xl sm:text-5xl font-semibold text-ink heading-tight">
              Upload a part. We&apos;ll handle the shop scramble.
            </h1>
            <p className="text-base text-ink-muted heading-snug">
              Zartman.io quietly routes your RFQs to vetted suppliers, collects bids, and helps you award work—without spam, blast emails, or spreadsheet gymnastics.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/quote" className={primaryCtaClasses}>
              Get quote
            </Link>
            <Link
              href="#how-it-works"
              className="inline-flex items-center justify-center rounded-full border border-ink-soft px-4 py-2 text-sm font-medium text-ink transition hover:bg-ink-soft/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              How it works
            </Link>
          </div>
          <div className="flex flex-col gap-2 text-xs text-ink-soft sm:flex-row sm:items-center sm:gap-3">
            {TRUST_SIGNALS.map((signal) => (
              <span key={signal} className="pill pill-muted">
                {signal}
              </span>
            ))}
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section id="how-it-works" className="space-y-6 scroll-mt-24">
          <header className="space-y-2">
            <h2 className="text-lg sm:text-xl font-semibold text-ink">
              How it works
            </h2>
            <p className="max-w-copy text-sm text-ink-muted">
              Three fast steps that keep buyers and suppliers aligned from upload to award.
            </p>
          </header>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {HOW_IT_WORKS_STEPS.map((step) => (
              <PortalCard
                key={step.title}
                title={step.title}
                description={step.description}
                className="h-full border-slate-900/60 bg-slate-950/70"
              />
            ))}
          </div>
        </section>

        {/* REQUEST DEMO */}
        <section
          id="request-demo"
          className="mx-auto mt-16 max-w-2xl space-y-4 px-4 pb-16"
        >
          <h2 className="text-lg font-semibold text-ink">Request a live demo</h2>
          <p className="text-sm text-ink-soft">
            Prefer a walkthrough before sending parts? Share your work email and
            we'll follow up to schedule a short demo and talk through your
            quoting workflow.
          </p>
          <EarlyAccessForm />
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
