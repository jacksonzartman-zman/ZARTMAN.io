/**
 * Phase 1 Polish checklist
 * - Done: Perceived speed (projects table skeleton rows)
 */

import clsx from "clsx";

import { PORTAL_SURFACE_CARD } from "@/app/(portals)/components/portalSurfaceTokens";

const PORTAL_SKELETON_PULSE = "motion-safe:animate-pulse motion-reduce:animate-none";

function Row() {
  return <div className={clsx("h-10 rounded bg-slate-800/20", PORTAL_SKELETON_PULSE)} />;
}

export default function SupplierProjectsLoading() {
  return (
    <div className="space-y-5">
      <div className={clsx(PORTAL_SURFACE_CARD, PORTAL_SKELETON_PULSE, "h-20")} />
      <section className={clsx(PORTAL_SURFACE_CARD, "p-6")}>
        <div className={clsx("h-4 w-48 rounded bg-slate-800/30", PORTAL_SKELETON_PULSE)} />
        <div className={clsx("mt-2 h-3 w-80 rounded bg-slate-800/20", PORTAL_SKELETON_PULSE)} />
        <div className="mt-6 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Row key={i} />
          ))}
        </div>
      </section>
    </div>
  );
}

