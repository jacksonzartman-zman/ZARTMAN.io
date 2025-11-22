import PortalCard from "../PortalCard";

const openQuotes = [
  { id: "Q-2045", status: "Awaiting review", due: "Dec 5" },
  { id: "Q-2041", status: "Revised price shared", due: "Dec 2" },
];

const nextSteps = [
  "Upload manufacturing drawings for your bracket assembly.",
  "Share target pricing so suppliers can respond faster.",
  "Invite teammates so they can follow conversations.",
];

export default function CustomerDashboardPage() {
  return (
    <div className="space-y-6">
      <PortalCard
        title="Open quotes"
        description="The latest RFQs that still need your attention."
        action={
          <button className="rounded-full border border-slate-700 px-4 py-1.5 text-xs font-semibold text-emerald-300 transition hover:border-emerald-400 hover:text-emerald-200">
            View all
          </button>
        }
      >
        <ul className="space-y-3">
          {openQuotes.map((quote) => (
            <li
              key={quote.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-900/70 bg-slate-900/30 px-4 py-3"
            >
              <div>
                <p className="font-medium text-white">{quote.id}</p>
                <p className="text-xs text-slate-400">{quote.status}</p>
              </div>
              <div className="text-xs text-slate-400">
                Due <span className="font-semibold text-slate-100">{quote.due}</span>
              </div>
            </li>
          ))}
        </ul>
      </PortalCard>

      <PortalCard
        title="Next steps"
        description="A lightweight onboarding checklist so future automation has a home."
      >
        <ol className="list-decimal space-y-2 pl-4 text-slate-300">
          {nextSteps.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </PortalCard>

      <PortalCard
        title="Activity feed"
        description="Placeholder events that will eventually stream from Supabase."
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-300">
            • Supplier Atlas updated the machining quote for chassis plate.
          </p>
          <p className="text-sm text-slate-300">
            • You uploaded 3 STL files to RFQ Q-2045.
          </p>
          <p className="text-sm text-slate-300">
            • Internal note added by Alex Parker.
          </p>
        </div>
      </PortalCard>
    </div>
  );
}
