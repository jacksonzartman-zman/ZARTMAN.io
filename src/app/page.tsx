import Link from "next/link";
import { primaryCtaClasses } from "@/lib/ctas";
import PortalCard from "@/app/(portals)/PortalCard";
import { FAQ_ITEMS } from "@/data/faq";
import { getActiveProviders } from "@/server/providers";

export const dynamic = "force-dynamic";

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

const WHO_ITS_FOR = [
  {
    title: "Manufacturing engineers & project owners",
    description:
      "Upload parts once, see quotes and lead times in one workspace instead of chasing email threads.",
  },
  {
    title: "Supply chain & sourcing teams",
    description:
      "Route RFQs to vetted suppliers and keep a clean record of bids, decisions, and awards for every project.",
  },
  {
    title: "Machine shops & manufacturers",
    description:
      "Receive right-fit RFQs from buyers who match your capabilities, not random jobs outside your wheelhouse.",
  },
];

const WHY_TEAMS_POINTS = [
  {
    title: "Less chaos, more focus",
    description:
      "We keep RFQs, bids, and decisions in one place so you spend less time chasing updates.",
  },
  {
    title: "Better supplier matches",
    description:
      "We pair your RFQs with vetted shops instead of blasting every job to everyone.",
  },
  {
    title: "Humans in the loop",
    description:
      "You&apos;re never stuck with a black-box algorithm—we&apos;re here if quotes stall or projects get weird.",
  },
];

const FEATURED_FAQ_ITEMS = FAQ_ITEMS.slice(0, 3);
const PROCESS_TABS = [
  { label: "CNC", isActive: true },
  { label: "3DP", isActive: false },
  { label: "Sheet Metal", isActive: false },
  { label: "Injection", isActive: false },
  { label: "Assembly", isActive: false },
  { label: "AI Mode", isActive: false },
];
const ghostCtaClasses =
  "inline-flex items-center justify-center rounded-full border border-ink-soft px-4 py-2 text-sm font-medium text-ink transition hover:bg-ink-soft/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

function getProviderInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return "??";
  }

  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

export default async function HomePage() {
  const activeProviders = await getActiveProviders();

  return (
    <main className="main-shell">
      <div className="mx-auto max-w-page px-4 sm:px-6 lg:px-8 py-16 sm:py-20 space-y-16">
        {/* HERO */}
        <section className="mx-auto max-w-5xl space-y-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-ink-soft">
            Manufacturing metasearch
          </p>
          <div className="space-y-4">
            <h1 className="text-4xl sm:text-5xl font-semibold text-ink heading-tight">
              Compare manufacturing quotes from top suppliers.
            </h1>
            <p className="text-base text-ink-muted heading-snug">
              Search multiple providers at once. No vendor lock-in.
            </p>
          </div>
          <div className="rounded-3xl border border-slate-900/70 bg-slate-950/60 p-4 shadow-[0_18px_50px_rgba(2,6,23,0.45)] sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              {PROCESS_TABS.map((tab) => (
                <button
                  key={tab.label}
                  type="button"
                  className={`rounded-full border px-4 py-2 text-xs font-semibold transition ${
                    tab.isActive
                      ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-100 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]"
                      : "border-slate-900/70 bg-slate-900/40 text-ink-soft hover:border-slate-700/80 hover:bg-slate-900/70"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="mt-4 rounded-2xl border border-slate-900/70 bg-slate-950/80 p-3">
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-[1.2fr,0.6fr,0.9fr,auto] lg:items-stretch">
                <label className="flex items-center justify-center gap-2 rounded-xl border border-slate-900/70 bg-slate-900/50 px-4 py-3 text-sm font-semibold text-ink transition hover:border-slate-700/80 hover:bg-slate-900/80">
                  <input
                    type="file"
                    accept=".zip,.step,.stp,.iges,.igs,.stl"
                    className="sr-only"
                  />
                  Upload CAD/ZIP
                </label>
                <label className="flex flex-col gap-1 rounded-xl border border-slate-900/70 bg-slate-900/50 px-4 py-3">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-soft">
                    Qty
                  </span>
                  <input
                    type="number"
                    min={1}
                    placeholder="50"
                    className="bg-transparent text-sm text-ink placeholder:text-ink-soft/70 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1 rounded-xl border border-slate-900/70 bg-slate-900/50 px-4 py-3">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-soft">
                    Need-by date
                  </span>
                  <input
                    type="date"
                    className="bg-transparent text-sm text-ink placeholder:text-ink-soft/70 focus:outline-none"
                  />
                </label>
                <Link
                  href="/customer/search"
                  className={`${primaryCtaClasses} w-full rounded-2xl px-6 py-3 text-sm lg:w-auto`}
                >
                  Search
                </Link>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2 text-xs text-ink-soft sm:flex-row sm:items-center sm:gap-3">
            {TRUST_SIGNALS.map((signal) => (
              <span key={signal} className="pill pill-muted">
                {signal}
              </span>
            ))}
          </div>
        </section>

        {/* TRUST */}
        <section className="rounded-3xl border border-slate-900/60 bg-slate-950/70 p-6 shadow-[0_12px_35px_rgba(2,6,23,0.4)] sm:p-8">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr),minmax(0,1.05fr)] lg:items-center">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink-soft">
                Trust network
              </p>
              <h2 className="text-2xl sm:text-3xl font-semibold text-ink heading-tight">
                Search across marketplaces, networks, and factories
              </h2>
              <p className="text-sm text-ink-muted heading-snug">
                We don&apos;t play favorites &mdash; results are ranked by value, speed,
                and risk.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {activeProviders.length === 0 ? (
                <span className="text-xs text-ink-soft">
                  Active providers will appear here.
                </span>
              ) : (
                activeProviders.map((provider) => {
                  const initials = getProviderInitials(provider.name);

                  return (
                    <div
                      key={provider.id}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-900/70 bg-slate-950/60 px-3 py-1.5 text-xs font-semibold text-ink shadow-[0_8px_20px_rgba(2,6,23,0.35)]"
                    >
                      <span
                        aria-hidden
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-700/80 bg-slate-900/70 text-[10px] font-semibold text-slate-200"
                      >
                        {initials}
                      </span>
                      <span>{provider.name}</span>
                    </div>
                  );
                })
              )}
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

        {/* WHO IT'S FOR */}
        <section id="who-its-for" className="space-y-6 scroll-mt-24">
          <header className="space-y-2">
            <h2 className="text-lg sm:text-xl font-semibold text-ink heading-tight">
              Who it&rsquo;s for
            </h2>
            <p className="max-w-copy text-sm text-ink-muted">
              Built for people who live in RFQs all day—on both sides of the table.
            </p>
          </header>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {WHO_ITS_FOR.map((persona) => (
              <div
                key={persona.title}
                className="rounded-2xl border border-slate-900/60 bg-slate-950/70 p-6 shadow-[0_10px_30px_rgba(2,6,23,0.35)]"
              >
                <h3 className="text-base font-semibold text-ink heading-tight">
                  {persona.title}
                </h3>
                <p className="mt-2 text-sm text-ink-muted heading-snug">
                  {persona.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* WHY TEAMS USE */}
        <section id="why-teams-use" className="space-y-6 scroll-mt-24">
          <header className="space-y-2">
            <h2 className="text-lg sm:text-xl font-semibold text-ink heading-tight">
              Why teams use Zartman.io
            </h2>
            <p className="max-w-copy text-sm text-ink-muted heading-snug">
              Not another blast RFQ tool—just a calmer way to move work from upload to award.
            </p>
          </header>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {WHY_TEAMS_POINTS.map((point) => (
              <div
                key={point.title}
                className="rounded-2xl border border-slate-900/60 bg-slate-950/70 p-6 shadow-[0_10px_30px_rgba(2,6,23,0.35)]"
              >
                <div className="flex gap-3">
                  <span
                    aria-hidden
                    className="mt-1 inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400/80"
                  />
                  <div>
                    <p className="text-base font-semibold text-ink heading-tight">
                      {point.title}
                    </p>
                    <p className="mt-2 text-sm text-ink-muted heading-snug">
                      {point.description}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* REQUEST DEMO */}
        <section
          id="request-demo"
          className="mx-auto mt-16 max-w-2xl space-y-5 rounded-3xl border border-slate-900/70 bg-slate-950/60 px-6 py-6 shadow-[0_15px_45px_rgba(2,6,23,0.4)]"
        >
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink-soft">
              Request a live demo
            </p>
            <h2 className="text-2xl font-semibold text-ink heading-tight">
              Prefer to talk it through?
            </h2>
            <p className="text-sm text-ink-muted heading-snug">
              We&apos;ll show how routing, quoting, and award decisions work end-to-end,
              then help you decide if you should send an RFQ or bring shops in later.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/contact" className={primaryCtaClasses}>
              Talk to Jackson
            </Link>
            <Link
              href="/quote"
              className={`${ghostCtaClasses} justify-center`}
            >
              Upload parts now
            </Link>
          </div>
          <p className="text-xs text-ink-soft">
            We typically reply within one business day with a Loom or a short call slot.
          </p>
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

        {/* FAQ */}
        <section id="faq" className="space-y-6 scroll-mt-24">
          <header className="space-y-2">
            <h2 className="text-lg sm:text-xl font-semibold text-ink">
              Questions we hear a lot
            </h2>
            <p className="text-sm text-ink-muted">
              Straight answers about privacy, control, and how work actually moves through Zartman.io.
            </p>
          </header>
          <dl className="space-y-5">
            {FEATURED_FAQ_ITEMS.map((item) => (
              <div key={item.question} className="space-y-2">
                <dt className="text-base font-semibold text-ink heading-tight">
                  {item.question}
                </dt>
                <dd className="text-sm text-ink-muted">{item.answer}</dd>
              </div>
            ))}
          </dl>
          <Link
            href="/faq"
            className="inline-flex text-xs font-medium text-ink transition hover:underline"
          >
            See all FAQs
          </Link>
        </section>

      </div>
    </main>
  );
}
