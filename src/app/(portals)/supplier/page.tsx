import Link from "next/link";
import PortalCard from "../PortalCard";
import {
  getSearchParamValue,
  normalizeEmailInput,
  type SearchParamsLike,
} from "@/app/(portals)/quotes/pageUtils";

const inboundRfqs = [
  {
    quoteId: "Q-1048A",
    company: "Lambda Robotics",
    value: "$18,400",
    files: 4,
  },
  {
    quoteId: "Q-2072B",
    company: "Northwind Aero",
    value: "$12,750",
    files: 2,
  },
];

const productionQueue = [
  { part: "Chassis plate", stage: "Machining", eta: "Dec 8" },
  { part: "Control enclosure", stage: "Powder coat", eta: "Dec 12" },
  { part: "Sensor bracket", stage: "QA", eta: "Dec 4" },
];

const FALLBACK_SUPPLIER_EMAIL = "ops@supply-demo.com";

type SupplierDashboardPageProps = {
  searchParams?: SearchParamsLike;
};

function SupplierDashboardPage({
  searchParams,
}: SupplierDashboardPageProps) {
  const emailParam = getSearchParamValue(searchParams, "email");
  const normalizedEmail = normalizeEmailInput(emailParam);
  const linkEmail = normalizedEmail ?? FALLBACK_SUPPLIER_EMAIL;
  const usingFallback = !normalizedEmail;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-4 text-sm text-slate-300">
        {usingFallback ? (
          <>
            <p>
              Showing sample supplier data for{" "}
              <span className="font-semibold text-white">{linkEmail}</span>.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Add ?email=you@supplier.com to this URL to preview your actual assignments.
            </p>
          </>
        ) : (
          <>
            <p>
              Viewing assignments scoped to{" "}
              <span className="font-semibold text-white">{linkEmail}</span>.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Every &quot;View quote&quot; link below passes your email so the workspace can confirm access.
            </p>
          </>
        )}
      </section>

      <PortalCard
        title="Inbound RFQs"
        description="Latest customer demand waiting for estimates."
        action={
          <Link
            href={`/supplier/quotes/${inboundRfqs[0].quoteId}?email=${encodeURIComponent(linkEmail)}`}
            className="rounded-full border border-slate-700 px-4 py-1.5 text-xs font-semibold text-blue-300 transition hover:border-blue-400 hover:text-blue-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
          >
            View sample quote
          </Link>
        }
      >
        <ul className="space-y-3">
          {inboundRfqs.map((rfq) => (
            <li key={rfq.quoteId}>
              <Link
                href={`/supplier/quotes/${rfq.quoteId}?email=${encodeURIComponent(linkEmail)}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-900/70 bg-slate-900/30 px-4 py-3 transition hover:border-blue-400/50 hover:bg-slate-900/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
              >
                <div>
                  <p className="font-medium text-white">{rfq.company}</p>
                  <p className="text-xs text-slate-400">
                    {rfq.files} files • Est. value {rfq.value}
                  </p>
                </div>
                <span className="text-xs font-semibold text-blue-200">
                  View quote &rarr;
                </span>
              </Link>
            </li>
          ))}
        </ul>
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

type NextAppPage = (props: {
  params?: Promise<Record<string, unknown>>;
  searchParams?: Promise<any>;
}) => ReturnType<typeof SupplierDashboardPage>;

export default SupplierDashboardPage as unknown as NextAppPage;
