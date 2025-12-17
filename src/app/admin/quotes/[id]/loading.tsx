/**
 * Phase 1 Polish checklist
 * - Done: Perceived speed (admin quote detail skeleton)
 */

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl border border-slate-900/60 bg-slate-800/20 ${className}`} />;
}

export default function AdminQuoteDetailLoading() {
  return (
    <div className="space-y-6">
      <SkeletonBlock className="h-20" />
      <SkeletonBlock className="h-32" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.65fr)_minmax(0,0.35fr)]">
        <SkeletonBlock className="h-72" />
        <SkeletonBlock className="h-72" />
      </div>
      <SkeletonBlock className="h-80" />
    </div>
  );
}

