/**
 * Phase 1 Polish checklist
 * - Done: Perceived speed (quotes table skeleton rows)
 */

function Row() {
  return (
    <div className="animate-pulse rounded-2xl border border-slate-900/60 bg-slate-950/40 px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="h-4 w-56 rounded bg-slate-800/30" />
          <div className="mt-2 h-3 w-[min(480px,85%)] rounded bg-slate-800/20" />
        </div>
        <div className="h-8 w-36 rounded-full bg-slate-800/25" />
      </div>
    </div>
  );
}

export default function CustomerQuotesLoading() {
  return (
    <div className="space-y-5">
      <div className="h-20 animate-pulse rounded-2xl border border-slate-900/60 bg-slate-800/20" />
      <section className="rounded-2xl border border-slate-900/60 bg-slate-950/60 p-6">
        <div className="h-4 w-40 animate-pulse rounded bg-slate-800/30" />
        <div className="mt-2 h-3 w-72 animate-pulse rounded bg-slate-800/20" />
        <div className="mt-6 space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Row key={i} />
          ))}
        </div>
      </section>
    </div>
  );
}

