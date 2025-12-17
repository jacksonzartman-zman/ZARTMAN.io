/**
 * Phase 1 Polish checklist
 * - Done: Perceived speed (QuoteAtAGlanceBar + first sections skeleton)
 */

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl border border-slate-900/60 bg-slate-800/20 ${className}`} />;
}

export default function SupplierQuoteDetailLoading() {
  return (
    <div className="space-y-5">
      <SkeletonBlock className="sticky top-4 z-30 h-32 backdrop-blur" />
      <div className="space-y-5 lg:grid lg:grid-cols-[minmax(0,0.65fr)_minmax(0,0.35fr)] lg:gap-5 lg:space-y-0">
        <div className="space-y-5">
          <SkeletonBlock className="h-64" />
          <SkeletonBlock className="h-64" />
          <SkeletonBlock className="h-72" />
        </div>
        <div className="space-y-5">
          <SkeletonBlock className="h-56" />
          <SkeletonBlock className="h-64" />
          <SkeletonBlock className="h-48" />
        </div>
      </div>
    </div>
  );
}

