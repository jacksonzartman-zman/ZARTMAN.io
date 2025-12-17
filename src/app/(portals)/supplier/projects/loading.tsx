/**
 * Phase 1 Polish checklist
 * - Done: Perceived speed (projects table skeleton rows)
 */

function Row() {
  return <div className="h-10 animate-pulse rounded bg-slate-800/20" />;
}

export default function SupplierProjectsLoading() {
  return (
    <div className="space-y-5">
      <div className="h-20 animate-pulse rounded-2xl border border-slate-900/60 bg-slate-800/20" />
      <section className="rounded-2xl border border-slate-900/60 bg-slate-950/60 p-6">
        <div className="h-4 w-48 animate-pulse rounded bg-slate-800/30" />
        <div className="mt-2 h-3 w-80 animate-pulse rounded bg-slate-800/20" />
        <div className="mt-6 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Row key={i} />
          ))}
        </div>
      </section>
    </div>
  );
}

