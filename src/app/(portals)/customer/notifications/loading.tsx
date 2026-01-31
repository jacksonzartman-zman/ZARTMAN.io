export default function Loading() {
  return (
    <div className="space-y-5">
      <div className="h-20 animate-pulse rounded-2xl border border-slate-900/60 bg-slate-800/20" />
      <div className="space-y-6">
        {Array.from({ length: 2 }).map((_, groupIndex) => (
          <section key={`group-${groupIndex}`} className="space-y-3">
            <div className="h-3 w-28 animate-pulse rounded bg-slate-800/25" />
            <ul className="space-y-2">
              {Array.from({ length: 4 }).map((_, itemIndex) => (
                <li
                  key={`item-${groupIndex}-${itemIndex}`}
                  className="animate-pulse rounded-2xl border border-slate-900/60 bg-slate-950/40 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="h-5 w-24 rounded-full bg-slate-800/20" />
                    <div className="h-5 w-16 rounded-full bg-slate-800/15" />
                  </div>
                  <div className="mt-3 space-y-2">
                    <div className="h-4 w-[min(520px,90%)] rounded bg-slate-800/25" />
                    <div className="h-3 w-[min(640px,100%)] rounded bg-slate-800/15" />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

