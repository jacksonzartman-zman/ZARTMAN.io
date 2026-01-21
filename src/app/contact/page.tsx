import Link from "next/link";
import ContactForm from "@/components/ContactForm";
import { SHOW_LEGACY_QUOTE_ENTRYPOINTS } from "@/lib/ui/deprecation";

export default function ContactPage() {
  const fastTrackHref = SHOW_LEGACY_QUOTE_ENTRYPOINTS
    ? "/quote"
    : "/customer/search";
  const fastTrackLabel = SHOW_LEGACY_QUOTE_ENTRYPOINTS
    ? "Start a search request instead"
    : "Search suppliers instead";
  const fastTrackCopy = SHOW_LEGACY_QUOTE_ENTRYPOINTS
    ? "Use this form when you want a walkthrough, help matching jobs to suppliers, or clarity on how we handle files. Ready to award work right now? You can always skip ahead and go straight to the search request intake form."
    : "Use this form when you want a walkthrough, help matching jobs to suppliers, or clarity on how we handle files. Ready to award work right now? You can always skip ahead and start a supplier search.";

  return (
    <main className="main-shell">
      <div className="mx-auto max-w-page px-4 py-16 sm:px-6 lg:px-8 sm:py-20 space-y-12">
        <section className="space-y-4 max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-ink-soft">
            Request a live demo
          </p>
          <h1 className="text-4xl sm:text-5xl font-semibold text-ink heading-tight">
            Talk through your search requests with the team behind Zartman.io
          </h1>
          <p className="text-base text-ink-muted heading-snug">
            {fastTrackCopy}
          </p>
          <p className="text-sm text-ink-soft">
            Working on something urgent?{" "}
            <Link
              href={fastTrackHref}
              className="font-semibold text-emerald-300 hover:text-emerald-200"
            >
              {fastTrackLabel}
            </Link>
            .
          </p>
        </section>

        <section className="grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <ContactForm />
          <aside className="rounded-3xl border border-slate-900/70 bg-slate-950/60 p-6 shadow-[0_20px_55px_rgba(2,6,23,0.4)] space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-200">
                What to expect
              </p>
              <h2 className="text-xl font-semibold text-ink heading-tight">
                Real humans, fast follow-up
              </h2>
              <p className="text-sm text-ink-muted heading-snug">
                Jackson personally reads every note. If we need more detail we&apos;ll reply with a short Loom, call, or request for sample parts.
              </p>
            </div>
            <ul className="space-y-3 text-sm text-ink-muted heading-snug">
              <li className="flex gap-3">
                <span aria-hidden className="mt-1 inline-flex h-2 w-2 rounded-full bg-emerald-300/90" />
                <span>We typically reply within one business day.</span>
              </li>
              <li className="flex gap-3">
                <span aria-hidden className="mt-1 inline-flex h-2 w-2 rounded-full bg-emerald-300/90" />
                <span>Replies come directly from Jackson—no ticketing bots.</span>
              </li>
              <li className="flex gap-3">
                <span aria-hidden className="mt-1 inline-flex h-2 w-2 rounded-full bg-emerald-300/90" />
                <span>
                  We&apos;ll usually ask for a sample part or recent search request so we can give
                  specific guidance.
                </span>
              </li>
            </ul>
            <p className="text-xs text-ink-soft">
              Need to loop in someone else? Hit reply on our email thread and add them—everything stays in one conversation.
            </p>
          </aside>
        </section>
      </div>
    </main>
  );
}
