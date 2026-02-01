/**
 * Phase 1 Polish checklist
 * - Done: Perceived speed (quotes table skeleton rows)
 */

import clsx from "clsx";

import { PORTAL_SURFACE_CARD } from "@/app/(portals)/components/portalSurfaceTokens";

const PORTAL_SKELETON_PULSE = "motion-safe:animate-pulse motion-reduce:animate-none";

function Row() {
  return (
    <div className={clsx(PORTAL_SURFACE_CARD, PORTAL_SKELETON_PULSE, "px-5 py-4")}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="h-4 w-56 rounded bg-slate-800/30" />
          <div className="mt-2 h-3 w-[min(480px,85%)] rounded bg-slate-800/20" />
        </div>
        <div className="h-8 w-36 rounded-full bg-slate-800/25" />
      </div>
    </div>
  );
}

export default function CustomerQuotesLoading() {
  return (
    <div className="space-y-5">
      <div className={clsx(PORTAL_SURFACE_CARD, PORTAL_SKELETON_PULSE, "h-20")} />
      <section className={clsx(PORTAL_SURFACE_CARD, "p-6")}>
        <div className={clsx("h-4 w-40 rounded bg-slate-800/30", PORTAL_SKELETON_PULSE)} />
        <div className={clsx("mt-2 h-3 w-72 rounded bg-slate-800/20", PORTAL_SKELETON_PULSE)} />
        <div className="mt-6 space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Row key={i} />
          ))}
        </div>
      </section>
    </div>
  );
}

