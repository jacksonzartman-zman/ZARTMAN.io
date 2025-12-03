import Link from "next/link";
import { FAQ_ITEMS } from "@/data/faq";

export default function FaqPage() {
  return (
    <main className="main-shell">
      <div className="mx-auto max-w-page px-4 sm:px-6 lg:px-8 py-16 sm:py-20 space-y-10">
        <div className="space-y-4 max-w-3xl">
          <Link
            href="/"
            className="inline-flex text-xs font-medium text-ink-soft transition hover:text-ink"
          >
            ← Back to homepage
          </Link>
          <div className="space-y-3">
            <h1 className="text-4xl sm:text-5xl font-semibold text-ink heading-tight">
              Frequently asked questions
            </h1>
            <p className="text-base text-ink-muted heading-snug">
              Straight answers about privacy, control, and how work moves through Zartman.io from RFQ to award.
            </p>
          </div>
        </div>

        <dl className="space-y-6 max-w-3xl">
          {FAQ_ITEMS.map((item) => (
            <div key={item.question} className="space-y-2">
              <dt className="text-base font-semibold text-ink heading-tight">
                {item.question}
              </dt>
              <dd className="text-sm text-ink-muted heading-snug">{item.answer}</dd>
            </div>
          ))}
        </dl>
      </div>
    </main>
  );
}
