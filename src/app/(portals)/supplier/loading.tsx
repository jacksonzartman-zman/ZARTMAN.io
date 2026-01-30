function SkeletonSection({ lines = 3 }: { lines?: number }) {
  return (
    <section className="rounded-2xl border border-slate-900/60 bg-slate-950/60 p-6">
      <div className="h-4 w-48 animate-pulse rounded bg-slate-800/30" />
      <div className="mt-2 h-3 w-64 animate-pulse rounded bg-slate-800/20" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: lines }).map((_, index) => (
          <div
            key={index}
            className="h-4 w-full animate-pulse rounded bg-slate-800/20"
          />
        ))}
      </div>
    </section>
  );
}

export default function SupplierDashboardLoading() {
  return (
    <div className="space-y-6">
      <div className="h-28 animate-pulse rounded-2xl border border-slate-900/60 bg-slate-800/20" />
      <div className="h-24 animate-pulse rounded-2xl border border-slate-900/60 bg-slate-800/15" />
      <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
        <div className="lg:col-span-8">
          <section className="rounded-3xl border border-slate-900/60 bg-slate-950/60 p-6">
            <div className="h-4 w-40 animate-pulse rounded bg-slate-800/30" />
            <div className="mt-2 h-3 w-56 animate-pulse rounded bg-slate-800/20" />
            <div className="mt-5 space-y-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={`row-${index}`}
                  className="h-10 w-full animate-pulse rounded-xl bg-slate-800/15"
                />
              ))}
            </div>
          </section>
        </div>
        <div className="space-y-6 lg:col-span-4">
          <SkeletonSection lines={3} />
          <SkeletonSection lines={2} />
        </div>
      </div>
    </div>
  );
}
