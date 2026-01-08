"use client";

import clsx from "clsx";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { QuoteAtAGlancePillTone } from "@/components/QuoteAtAGlanceBar";

export type QuoteSectionRailTone = "neutral" | "info" | "warning";

export type QuoteSectionRailSection = {
  key: string;
  label: string;
  href: string;
  badge?: string;
  tone?: QuoteSectionRailTone;
};

type CurrentLocation = {
  pathname: string;
  search: string;
  hash: string;
  href: string;
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

  const [location, setLocation] = useState<CurrentLocation | null>(null);
  useEffect(() => {
    const read = () =>
      setLocation({
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
        href: window.location.href,
      });
    read();
    window.addEventListener("hashchange", read);
    window.addEventListener("popstate", read);
    return () => {
      window.removeEventListener("hashchange", read);
      window.removeEventListener("popstate", read);
    };
  }, []);

  const defaultHashHref = useMemo(
    () => sections.find((s) => s.href.startsWith("#"))?.href ?? null,
    [sections],
  );

  return (
    <nav
      className={clsx("overflow-x-auto pb-1", className)}
      aria-label="Quote sections"
    >
      <div className="flex min-w-max flex-wrap gap-2">
        {sections.map((section) => (
          <SectionChip
            key={section.key}
            section={section}
            isActive={isSectionActive({
              sectionHref: section.href,
              location,
              defaultHashHref,
            })}
          />
        ))}
      </div>
    </nav>
  );
}

function isSectionActive(args: {
  sectionHref: string;
  location: CurrentLocation | null;
  defaultHashHref: string | null;
}) {
  const { sectionHref, location, defaultHashHref } = args;
  if (!location) return false;

  if (sectionHref.startsWith("#")) {
    const currentHash = location.hash || "";
    if (currentHash) {
      return currentHash === sectionHref;
    }
    return defaultHashHref === sectionHref;
  }

  try {
    const target = new URL(sectionHref, location.href);
    return location.pathname + location.search === target.pathname + target.search;
  } catch {
    return false;
  }
}

function SectionChip({
  section,
  isActive,
}: {
  section: QuoteSectionRailSection;
  isActive: boolean;
}) {
  const tone: QuoteAtAGlancePillTone = mapRailToneToPillTone(section.tone);
  const base =
    "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold";
  const classes =
    tone === "info"
      ? clsx(
          "text-blue-100",
          isActive
            ? "border-blue-400/55 bg-blue-500/15"
            : "border-blue-500/30 bg-blue-500/10 hover:border-blue-400/50",
        )
      : tone === "warning"
        ? clsx(
            "text-amber-100",
            isActive
              ? "border-amber-400/55 bg-amber-500/15"
              : "border-amber-500/30 bg-amber-500/10 hover:border-amber-400/50",
          )
        : clsx(
            "text-slate-200",
            isActive
              ? "border-slate-600/70 bg-slate-950/70 text-slate-50"
              : "border-slate-800 bg-slate-950/50 hover:border-slate-700",
          );

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
      <a
        href={section.href}
        className={clsx(base, classes)}
        aria-current={isActive ? "location" : undefined}
      >
        {content}
      </a>
    );
  }

  return (
    <Link
      href={section.href}
      className={clsx(base, classes)}
      aria-current={isActive ? "location" : undefined}
    >
      {content}
    </Link>
  );
}

function mapRailToneToPillTone(tone?: QuoteSectionRailTone): QuoteAtAGlancePillTone {
  if (tone === "info") return "info";
  if (tone === "warning") return "warning";
  return "neutral";
}

