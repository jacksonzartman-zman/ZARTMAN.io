/**
 * Phase 1 Polish checklist
 * - Done: Perceived speed (admin quotes list skeleton)
 */

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl border border-slate-900/60 bg-slate-800/20 ${className}`} />;
}

export default function AdminQuotesLoading() {
  return (
    <div className="space-y-6">
      <SkeletonBlock className="h-16" />
      <SkeletonBlock className="h-14" />
      <SkeletonBlock className="h-[520px]" />
    </div>
  );
}

