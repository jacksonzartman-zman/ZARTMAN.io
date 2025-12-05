import { DEFAULT_SUPPLIER_KICKOFF_TASKS } from "@/lib/quote/kickoffChecklist";

export function KickoffChecklist() {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/60 px-6 py-5">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Kickoff checklist
        </p>
        <h2 className="text-lg font-semibold text-white">
          Prep steps before PO release
        </h2>
        <p className="text-sm text-slate-300">
          Here&apos;s the standard 5-point checklist we captured for winning suppliers.
          We&apos;ll remember your progress as soon as kickoff tracking is enabled in
          this workspace.
        </p>
      </header>
      <ul className="mt-4 space-y-3">
        {DEFAULT_SUPPLIER_KICKOFF_TASKS.map((task) => (
          <li
            key={task.taskKey}
            className="rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3"
          >
            <p className="text-sm font-semibold text-white">{task.title}</p>
            <p className="text-sm text-slate-300">{task.description}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
