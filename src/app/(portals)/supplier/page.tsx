import PortalCard from "../PortalCard";

const inboundRfqs = [
  { company: "Lambda Robotics", value: "$18,400", files: 4 },
  { company: "Northwind Aero", value: "$12,750", files: 2 },
];

const productionQueue = [
  { part: "Chassis plate", stage: "Machining", eta: "Dec 8" },
  { part: "Control enclosure", stage: "Powder coat", eta: "Dec 12" },
  { part: "Sensor bracket", stage: "QA", eta: "Dec 4" },
];

export default function SupplierDashboardPage() {
  return (
    <div className="space-y-6">
      <PortalCard
        title="Inbound RFQs"
        description="Latest customer demand waiting for estimates."
        action={
          <button className="rounded-full border border-slate-700 px-4 py-1.5 text-xs font-semibold text-blue-300 transition hover:border-blue-400 hover:text-blue-200">
            Open inbox
          </button>
        }
      >
        <div className="space-y-3">
          {inboundRfqs.map((rfq) => (
            <div
              key={rfq.company}
              className="rounded-xl border border-slate-900/70 bg-slate-900/30 px-4 py-3"
            >
              <p className="font-medium text-white">{rfq.company}</p>
              <p className="text-xs text-slate-400">
                {rfq.files} files • Est. value {rfq.value}
              </p>
            </div>
          ))}
        </div>
      </PortalCard>

      <PortalCard
        title="Production queue"
        description="High-level view of what is in-flight."
      >
        <div className="grid gap-3 md:grid-cols-3">
          {productionQueue.map((item) => (
            <div
              key={item.part}
              className="rounded-xl border border-slate-900/70 bg-slate-900/30 px-4 py-3"
            >
              <p className="text-sm font-semibold text-white">{item.part}</p>
              <p className="text-xs text-slate-400">{item.stage}</p>
              <p className="mt-2 text-xs text-slate-400">
                ETA <span className="font-semibold text-slate-100">{item.eta}</span>
              </p>
            </div>
          ))}
        </div>
      </PortalCard>

      <PortalCard
        title="Announcements"
        description="Surface alerts, compliance reminders, and shared files soon."
      >
        <ul className="space-y-2 text-sm text-slate-300">
          <li>• UL certification docs uploaded by Zartman admin.</li>
          <li>• New rev of control enclosure shared with suppliers.</li>
          <li>• Holiday operating hours reminder.</li>
        </ul>
      </PortalCard>
    </div>
  );
}
