function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl bg-slate-900/40 ${className}`} />;
}

export default function CustomerDashboardLoading() {
  return (
    <div className="space-y-6">
      <SkeletonBlock className="h-28 border border-slate-900" />
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((key) => (
          <SkeletonBlock
            key={`metric-${key}`}
            className="h-32 border border-slate-900"
          />
        ))}
      </div>
      {[0, 1, 2].map((key) => (
        <div
          key={`card-${key}`}
          className="space-y-3 rounded-2xl border border-slate-900 bg-slate-950/60 p-6"
        >
          <div className="h-4 w-40 animate-pulse rounded bg-slate-800/80" />
          <div className="h-3 w-64 animate-pulse rounded bg-slate-800/60" />
          <div className="h-24 animate-pulse rounded-xl bg-slate-900/40" />
        </div>
      ))}
    </div>
  );
}
