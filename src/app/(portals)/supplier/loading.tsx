function SkeletonSection({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-2xl border border-slate-900 bg-slate-950/60 p-6">
      <div className="h-4 w-48 animate-pulse rounded bg-slate-800/80" />
      <div className="mt-2 h-3 w-64 animate-pulse rounded bg-slate-800/60" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: lines }).map((_, index) => (
          <div
            key={index}
            className="h-4 w-full animate-pulse rounded bg-slate-900/40"
          />
        ))}
      </div>
    </div>
  );
}

export default function SupplierDashboardLoading() {
  return (
    <div className="space-y-6">
      <div className="h-28 animate-pulse rounded-2xl border border-slate-900 bg-slate-950/70" />
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((key) => (
          <div
            key={`metric-${key}`}
            className="h-32 animate-pulse rounded-2xl border border-slate-900 bg-slate-900/40"
          />
        ))}
      </div>
      <SkeletonSection lines={4} />
      <SkeletonSection lines={5} />
      <SkeletonSection lines={3} />
    </div>
  );
}
