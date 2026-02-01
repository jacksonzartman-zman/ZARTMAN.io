import clsx from "clsx";

import { PORTAL_SURFACE_CARD } from "@/app/(portals)/components/portalSurfaceTokens";

const PORTAL_SKELETON_PULSE = "motion-safe:animate-pulse motion-reduce:animate-none";

function SkeletonBlock({ className }: { className: string }) {
  return (
    <div
      className={clsx(PORTAL_SURFACE_CARD, PORTAL_SKELETON_PULSE, className)}
    />
  );
}

export default function CustomerDashboardLoading() {
  return (
    <div className="space-y-6">
      <SkeletonBlock className="h-28" />
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((key) => (
          <SkeletonBlock key={`metric-${key}`} className="h-32" />
        ))}
      </div>
      {[0, 1, 2].map((key) => (
        <section
          key={`card-${key}`}
          className={clsx(PORTAL_SURFACE_CARD, "p-6")}
        >
          <div className={clsx("h-4 w-36 rounded bg-slate-800/30", PORTAL_SKELETON_PULSE)} />
          <div
            className={clsx("mt-2 h-3 w-64 rounded bg-slate-800/20", PORTAL_SKELETON_PULSE)}
          />
          <div className="mt-5 space-y-2">
            {[0, 1, 2].map((line) => (
              <div
                key={`line-${line}`}
                className={clsx("h-4 w-full rounded bg-slate-800/20", PORTAL_SKELETON_PULSE)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
