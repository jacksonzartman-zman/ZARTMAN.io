import clsx from "clsx";

import { PORTAL_SURFACE_CARD } from "@/app/(portals)/components/portalSurfaceTokens";

const PORTAL_SKELETON_PULSE = "motion-safe:animate-pulse motion-reduce:animate-none";

function SkeletonSection({ lines = 3 }: { lines?: number }) {
  return (
    <section className={clsx(PORTAL_SURFACE_CARD, "p-6")}>
      <div className={clsx("h-4 w-48 rounded bg-slate-800/30", PORTAL_SKELETON_PULSE)} />
      <div className={clsx("mt-2 h-3 w-64 rounded bg-slate-800/20", PORTAL_SKELETON_PULSE)} />
      <div className="mt-4 space-y-2">
        {Array.from({ length: lines }).map((_, index) => (
          <div
            key={index}
            className={clsx("h-4 w-full rounded bg-slate-800/20", PORTAL_SKELETON_PULSE)}
          />
        ))}
      </div>
    </section>
  );
}

export default function SupplierDashboardLoading() {
  return (
    <div className="space-y-5">
      <div className={clsx("h-28", PORTAL_SURFACE_CARD, PORTAL_SKELETON_PULSE)} />
      <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
        <div className="lg:col-span-9">
          <section className={clsx(PORTAL_SURFACE_CARD, "rounded-3xl p-6")}>
            <div className={clsx("h-4 w-40 rounded bg-slate-800/30", PORTAL_SKELETON_PULSE)} />
            <div className={clsx("mt-2 h-3 w-56 rounded bg-slate-800/20", PORTAL_SKELETON_PULSE)} />
            <div className="mt-5 space-y-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={`row-${index}`}
                  className={clsx("h-10 w-full rounded-xl bg-slate-800/15", PORTAL_SKELETON_PULSE)}
                />
              ))}
            </div>
          </section>
        </div>
        <div className="space-y-6 lg:col-span-3">
          <section className={clsx(PORTAL_SURFACE_CARD, "p-6")}>
            <div className={clsx("h-3 w-24 rounded bg-slate-800/25", PORTAL_SKELETON_PULSE)} />
            <div className="mt-4 grid grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={`recap-${index}`} className="space-y-2">
                  <div className={clsx("h-3 w-16 rounded bg-slate-800/20", PORTAL_SKELETON_PULSE)} />
                  <div className={clsx("h-5 w-10 rounded bg-slate-800/25", PORTAL_SKELETON_PULSE)} />
                </div>
              ))}
            </div>
          </section>
          <SkeletonSection lines={3} />
          <SkeletonSection lines={2} />
        </div>
      </div>
    </div>
  );
}
