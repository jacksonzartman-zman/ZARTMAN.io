/**
 * Phase 1 Polish checklist
 * - Done: Perceived speed (QuoteAtAGlanceBar + first sections skeleton)
 */

import clsx from "clsx";

import { PORTAL_SURFACE_CARD } from "@/app/(portals)/components/portalSurfaceTokens";

const PORTAL_SKELETON_PULSE = "motion-safe:animate-pulse motion-reduce:animate-none";

function SkeletonBlock({ className }: { className: string }) {
  return <div className={clsx(PORTAL_SURFACE_CARD, PORTAL_SKELETON_PULSE, className)} />;
}

export default function CustomerQuoteDetailLoading() {
  return (
    <div className="space-y-5">
      <SkeletonBlock className="sticky top-4 z-30 h-32 backdrop-blur" />
      <div className="space-y-5 lg:grid lg:grid-cols-12 lg:items-start lg:gap-8 lg:space-y-0">
        <div className="space-y-5 lg:col-span-9">
          <SkeletonBlock className="h-64" />
          <SkeletonBlock className="h-56" />
          <SkeletonBlock className="h-72" />
        </div>
        <div className="space-y-5 lg:col-span-3">
          <SkeletonBlock className="h-56" />
          <SkeletonBlock className="h-64" />
          <SkeletonBlock className="h-48" />
        </div>
      </div>
    </div>
  );
}

