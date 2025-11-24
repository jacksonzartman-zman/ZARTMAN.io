function SkeletonBlock({ className }: { className: string }) {
  return (
    <div
      className={`animate-pulse rounded-2xl border border-slate-900/60 bg-slate-800/20 ${className}`}
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
          className="rounded-2xl border border-slate-900/60 bg-slate-950/60 p-6"
        >
          <div className="h-4 w-36 animate-pulse rounded bg-slate-800/30" />
          <div className="mt-2 h-3 w-64 animate-pulse rounded bg-slate-800/20" />
          <div className="mt-5 space-y-2">
            {[0, 1, 2].map((line) => (
              <div
                key={`line-${line}`}
                className="h-4 w-full animate-pulse rounded bg-slate-800/20"
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
