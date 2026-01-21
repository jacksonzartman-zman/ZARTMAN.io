import Link from "next/link";

import { primaryCtaClasses } from "@/lib/ctas";
import { SHOW_LEGACY_QUOTE_ENTRYPOINTS } from "@/lib/ui/deprecation";
import {
  CAPABILITY_ENVELOPES,
  CAPABILITY_PROCESSES,
  OUT_OF_SCOPE_NOTES,
} from "@/data/capabilities";
import { FAQ_ITEMS } from "@/data/faq";

const talkCapabilitiesHref =
  "mailto:hello@zartman.io?subject=Talk%20about%20capabilities";

const secondaryGhostButtonClasses =
  "inline-flex items-center justify-center rounded-full border border-ink-soft px-4 py-2 text-sm font-medium text-ink transition hover:bg-ink-soft/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

const findFaqAnswer = (question: string) =>
  FAQ_ITEMS.find((item) => item.question === question)?.answer;

const MATCHING_POINTS = [
  {
    title: "Curated supplier bench",
    body:
      "We match your search request with a small bench of trusted shops—no auctions, no race-to-the-bottom blast lists.",
  },
  {
    title: "Private routing",
    body:
      findFaqAnswer("Who sees my CAD files and search requests?") ??
      "We only share search requests and files with suppliers matched to your project—no public job boards or blast lists.",
  },
  {
    title: "Hands-on monitoring",
    body:
      findFaqAnswer("What if a supplier ghosts or misses a date?") ??
      "We monitor activity in your workspace and can reroute jobs or bring in another supplier if something goes sideways.",
  },
];

export default function CapabilitiesPage() {
  const primaryCtaHref = SHOW_LEGACY_QUOTE_ENTRYPOINTS
    ? "/quote"
    : "/customer/search";
  const primaryCtaLabel = SHOW_LEGACY_QUOTE_ENTRYPOINTS
    ? "Start a search request"
    : "Search suppliers";

  return (
    <main className="main-shell">
      <div className="mx-auto max-w-page px-4 sm:px-6 lg:px-8 py-16 sm:py-20 space-y-16">
        {/* HERO */}
        <section className="mx-auto max-w-4xl space-y-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-ink-soft">
            Capabilities overview
          </p>
          <div className="space-y-4">
            <h1 className="text-4xl sm:text-5xl font-semibold text-ink heading-tight">
              What we can help you make
            </h1>
            <p className="text-base text-ink-muted heading-snug">
              Zartman.io routes CNC, sheet metal, 3D printing, and light assembly work to vetted shops that handle prototypes through recurring low-volume builds. Share your search request, keep files private, and get matched with suppliers who already run similar materials and complexity.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link href={primaryCtaHref} className={primaryCtaClasses}>
              {primaryCtaLabel}
            </Link>
            <Link href={talkCapabilitiesHref} className={secondaryGhostButtonClasses}>
              Talk about capabilities
            </Link>
          </div>
          <p className="text-xs text-ink-soft">
            Typical matches: tight-tolerance metal prototypes, formed enclosures with hardware, 3DP validation builds, and assemblies that need finishing before shipment.
          </p>
        </section>

        {/* PROCESS GRID */}
        <section className="space-y-6" id="processes">
          <header className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-ink-soft">
              Processes
            </p>
            <h2 className="text-lg sm:text-xl font-semibold text-ink heading-tight">
              Where we&apos;re strongest
            </h2>
            <p className="max-w-copy text-sm text-ink-muted">
              These offerings cover most search requests we route today. Each card spells out the sweet spot and when you might need a different partner.
            </p>
          </header>
          <div className="grid gap-4 sm:grid-cols-2">
            {CAPABILITY_PROCESSES.map((process) => (
              <div
                key={process.title}
                className="flex h-full flex-col gap-4 rounded-2xl border border-slate-900/60 bg-slate-950/70 p-6 shadow-[0_12px_35px_rgba(2,6,23,0.35)]"
              >
                <div className="space-y-2">
                  <h3 className="text-base font-semibold text-ink heading-tight">
                    {process.title}
                  </h3>
                  <p className="text-sm text-ink-muted heading-snug">
                    {process.description}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-ink-soft">
                    Best for
                  </p>
                  <ul className="mt-2 list-none space-y-1 text-sm text-ink-muted">
                    {process.bestFor.map((item) => (
                      <li key={item} className="pl-4 text-sm leading-snug text-ink-muted">
                        <span aria-hidden className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400/80 align-middle" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl border border-white/5 bg-white/5 px-4 py-3 text-sm text-ink-soft">
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-ink-soft">
                    Not a fit when
                  </p>
                  <p className="mt-1 text-sm text-ink-soft">
                    {process.notFitWhen}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* TOLERANCES & ENVELOPES */}
        <section className="space-y-6" id="tolerances">
          <header className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-ink-soft">
              Tolerances & envelopes
            </p>
            <h2 className="text-lg sm:text-xl font-semibold text-ink heading-tight">
              Approximate ranges so you can sanity-check fit
            </h2>
            <p className="max-w-copy text-sm text-ink-muted">
              These ranges keep expectations calibrated without over-promising. Send the search request if you&apos;re near the edge—we&apos;ll flag it early if it needs a different setup.
            </p>
          </header>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITY_ENVELOPES.map((spec) => (
              <div
                key={spec.label}
                className="rounded-2xl border border-slate-900/60 bg-slate-950/70 p-5 shadow-[0_12px_35px_rgba(2,6,23,0.35)]"
              >
                <dt className="text-sm font-semibold text-ink heading-tight">
                  {spec.label}
                </dt>
                <dd className="mt-2 text-sm text-ink-muted heading-snug">
                  {spec.value}
                </dd>
                {spec.helper ? (
                  <p className="mt-2 text-xs text-ink-soft">{spec.helper}</p>
                ) : null}
              </div>
            ))}
          </dl>
        </section>

        {/* WHAT WE DON'T DO */}
        <section className="space-y-6" id="out-of-scope">
          <header className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-ink-soft">
              What we don&apos;t do (yet)
            </p>
            <h2 className="text-lg sm:text-xl font-semibold text-ink heading-tight">
              If your search request looks like this, we&apos;ll recommend other options
            </h2>
            <p className="max-w-copy text-sm text-ink-muted">
              Calling this out early keeps trust high. If you send something in this category we&apos;ll still help you find a better match elsewhere.
            </p>
          </header>
          <ul className="space-y-3 text-sm text-ink-muted">
            {OUT_OF_SCOPE_NOTES.map((note) => (
              <li
                key={note}
                className="rounded-2xl border border-slate-900/60 bg-slate-950/60 px-5 py-3 heading-snug"
              >
                {note}
              </li>
            ))}
          </ul>
        </section>

        {/* HOW MATCHING WORKS */}
        <section className="space-y-6" id="matching">
          <header className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-ink-soft">
              How matching works
            </p>
            <h2 className="text-lg sm:text-xl font-semibold text-ink heading-tight">
              Same flow as the homepage—just zoomed in on capabilities
            </h2>
            <p className="max-w-copy text-sm text-ink-muted">
              We keep the marketplace private, curated, and human-supported so search requests land with the right suppliers the first time.
            </p>
          </header>
          <ul className="space-y-4">
            {MATCHING_POINTS.map((point) => (
              <li
                key={point.title}
                className="rounded-2xl border border-slate-900/60 bg-slate-950/70 p-5 shadow-[0_12px_35px_rgba(2,6,23,0.35)]"
              >
                <p className="text-sm font-semibold text-ink heading-tight">
                  {point.title}
                </p>
                <p className="mt-2 text-sm text-ink-muted heading-snug">
                  {point.body}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
