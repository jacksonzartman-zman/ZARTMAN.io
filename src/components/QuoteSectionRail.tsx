import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";
import type { QuoteAtAGlancePillTone } from "@/components/QuoteAtAGlanceBar";

export type QuoteSectionRailTone = "neutral" | "info" | "warning";

export type QuoteSectionRailSection = {
  key: string;
  label: string;
  href: string;
  badge?: string;
  tone?: QuoteSectionRailTone;
};

export function QuoteSectionRail({
  sections,
  className,
}: {
  sections: QuoteSectionRailSection[];
  className?: string;
}) {
  if (!sections || sections.length === 0) {
    return null;
  }

  return (
    <nav
      className={clsx("overflow-x-auto pb-1", className)}
      aria-label="Quote sections"
    >
      <div className="flex min-w-max flex-wrap gap-2">
        {sections.map((section) => (
          <SectionChip key={section.key} section={section} />
        ))}
      </div>
    </nav>
  );
}

function SectionChip({ section }: { section: QuoteSectionRailSection }) {
  const tone: QuoteAtAGlancePillTone = mapRailToneToPillTone(section.tone);
  const base =
    "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold";
  const classes =
    tone === "info"
      ? "border-blue-500/30 bg-blue-500/10 text-blue-100 hover:border-blue-400/50"
      : tone === "warning"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-100 hover:border-amber-400/50"
        : "border-slate-800 bg-slate-950/50 text-slate-200 hover:border-slate-700";

  const content: ReactNode = (
    <>
      <span className="whitespace-nowrap">{section.label}</span>
      {section.badge ? (
        <span className="ml-1 inline-flex min-w-6 items-center justify-center rounded-full border border-slate-800 bg-black/30 px-2 py-0.5 text-[10px] font-semibold text-slate-200">
          {section.badge}
        </span>
      ) : null}
    </>
  );

  if (section.href.startsWith("#")) {
    return (
      <a href={section.href} className={clsx(base, classes)}>
        {content}
      </a>
    );
  }

  return (
    <Link href={section.href} className={clsx(base, classes)}>
      {content}
    </Link>
  );
}

function mapRailToneToPillTone(tone?: QuoteSectionRailTone): QuoteAtAGlancePillTone {
  if (tone === "info") return "info";
  if (tone === "warning") return "warning";
  return "neutral";
}

