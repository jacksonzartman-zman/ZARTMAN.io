import Link from "next/link";
import { SHOW_LEGACY_QUOTE_ENTRYPOINTS } from "@/lib/ui/deprecation";
import {
  BUYER_SUPPORT_POINTS,
  LOOKING_AHEAD_POINTS,
  SUPPLIER_SUPPORT_POINTS,
  TEAM_MEMBERS,
} from "@/data/about";

export default function AboutPage() {
  const primaryCtaHref = SHOW_LEGACY_QUOTE_ENTRYPOINTS
    ? "/quote"
    : "/customer/search";
  const primaryCtaLabel = SHOW_LEGACY_QUOTE_ENTRYPOINTS
    ? "start a search request"
    : "search suppliers";

  return (
    <main className="main-shell">
      <div className="mx-auto max-w-page px-4 py-16 sm:px-6 lg:px-8 sm:py-20 space-y-16">
        <section className="space-y-5 max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-ink-soft">
            About Zartman.io
          </p>
          <div className="space-y-4">
            <h1 className="text-4xl sm:text-5xl font-semibold text-ink heading-tight">
              Calmer search requests, curated shops, real humans.
            </h1>
            <p className="text-base text-ink-muted heading-snug">
              Zartman.io exists because most search requests still pinball between inboxes,
              spreadsheets, and endless status calls. We built one calm workspace where buyers can
              upload parts, route to a trusted bench of shops, and keep every DFM note, bid, and
              award decision in the same view.
            </p>
            <p className="text-base text-ink-muted heading-snug">
              The goal isn&apos;t another blast marketplace. It&apos;s a service that pairs vetted suppliers with the right kind of work, keeps conversations private, and steps in when projects get weird so teams can keep moving.
            </p>
          </div>
          <p className="text-sm text-ink-soft">
            Ready to send parts today? Skip the tour and{" "}
            <Link
              href={primaryCtaHref}
              className="font-semibold text-emerald-300 hover:text-emerald-200"
            >
              {primaryCtaLabel}
            </Link>
            .
          </p>
        </section>

        <section className="space-y-6">
          <header className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-ink-soft">
              The people behind it
            </p>
            <h2 className="text-2xl sm:text-3xl font-semibold text-ink heading-tight">
              Built by people who have lived inside search requests
            </h2>
            <p className="text-sm text-ink-muted heading-snug">
              We&apos;ll keep adding more of the crew here. For now, you&apos;re mostly talking to Jackson.
            </p>
          </header>

          <div className="grid gap-4 sm:grid-cols-2">
            {TEAM_MEMBERS.map((member) => (
              <article
                key={member.name}
                className="rounded-3xl border border-slate-900/70 bg-slate-950/60 p-6 shadow-[0_15px_45px_rgba(2,6,23,0.45)]"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-200">
                  {member.role}
                </p>
                <h3 className="mt-2 text-xl font-semibold text-ink heading-tight">
                  {member.name}
                </h3>
                <p className="mt-3 text-sm text-ink-muted heading-snug">{member.bio}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <ListCard
            eyebrow="How we work with buyers"
            title="A calm cockpit for uploads, bids, and awards"
            description="We help you keep search requests private, keep suppliers accountable, and make confident award calls."
            items={BUYER_SUPPORT_POINTS}
          />
          <ListCard
            eyebrow="How we work with suppliers"
            title="A better bench for shops"
            description="Shops get the right work, space to ask questions, and a clear read on outcomes."
            items={SUPPLIER_SUPPORT_POINTS}
          />
        </section>

        <section className="rounded-3xl border border-slate-900/70 bg-slate-950/60 p-6 shadow-[0_20px_55px_rgba(2,6,23,0.4)] space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-200">
            Looking ahead
          </p>
          <h2 className="text-2xl font-semibold text-ink heading-tight">
            Where this is going
          </h2>
          <p className="text-sm text-ink-muted heading-snug">
            We&apos;re shipping tools that make matching faster and quoting less manual, without taking humans out of the loop. The roadmap is grounded in what buyers and shops ask for every week.
          </p>
          <DotList items={LOOKING_AHEAD_POINTS} />
        </section>
      </div>
    </main>
  );
}

type ListCardProps = {
  eyebrow: string;
  title: string;
  description: string;
  items: string[];
};

function ListCard({ eyebrow, title, description, items }: ListCardProps) {
  return (
    <article className="rounded-3xl border border-slate-900/70 bg-slate-950/60 p-6 shadow-[0_15px_45px_rgba(2,6,23,0.45)] space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-emerald-200">
        {eyebrow}
      </p>
      <h3 className="text-xl font-semibold text-ink heading-tight">{title}</h3>
      <p className="text-sm text-ink-muted heading-snug">{description}</p>
      <DotList items={items} />
    </article>
  );
}

function DotList({ items }: { items: string[] }) {
  return (
    <ul className="mt-4 space-y-3 text-sm text-ink heading-snug">
      {items.map((item) => (
        <li key={item} className="flex gap-3 text-ink-muted">
          <span
            aria-hidden
            className="mt-1 inline-flex h-2 w-2 rounded-full bg-emerald-300/90"
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
