import HomeHeroUploadPanel from "@/components/marketing/HomeHeroUploadPanel";
import { getActiveProviders } from "@/server/providers";
import { getServerAuthUser } from "@/server/auth";

export const dynamic = "force-dynamic";

const TRUST_SIGNALS = [
  "Built by manufacturing sales leaders",
  "Files stay private and secure",
  "No blast emails or marketplace spam",
];

const HOW_IT_WORKS_STEPS = [
  {
    title: "Submit your search request",
    description: "Share CAD files, quantities, and due dates in one place.",
  },
  {
    title: "We route to vetted providers",
    description: "Your search request goes to a small bench—no auctions or spam blasts.",
  },
  {
    title: "Review and award",
    description: "Compare quotes side-by-side and pick the winner.",
  },
];
const PROCESS_TABS = [
  {
    key: "cnc",
    label: "CNC",
    description: "Precision machining for tight tolerances and repeatable runs.",
    examples: ["Aluminum housings", "Steel shafts", "Prototype fixtures"],
  },
  {
    key: "3dp",
    label: "3DP",
    description: "Fast iterations for complex geometry and lightweight parts.",
    examples: ["SLS brackets", "SLA prototypes", "MJF enclosures"],
  },
  {
    key: "sheet-metal",
    label: "Sheet Metal",
    description: "Formed and cut parts with quick turn and scalable volumes.",
    examples: ["Laser-cut panels", "Brake-formed brackets", "Chassis"],
  },
  {
    key: "injection",
    label: "Injection",
    description: "Production tooling for consistent, high-volume plastic parts.",
    examples: ["ABS housings", "Overmolded grips", "Consumer enclosures"],
  },
  {
    key: "assembly",
    label: "Assembly",
    description: "Kitting, sub-assemblies, and final builds end to end.",
    examples: ["Hardware installs", "Labeling", "Functional tests"],
  },
  {
    key: "ai-mode",
    label: "AI Mode",
    description: "Let AI route the best process and supplier mix quickly.",
    examples: ["Auto-matched suppliers", "Risk flags", "Price targets"],
  },
];

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function resolveSearchParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getProviderInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return "??";
  }

  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const activeProviders = await getActiveProviders();
  const { user } = await getServerAuthUser({ quiet: true });
  const isAuthenticated = Boolean(user);
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const processParam = resolveSearchParam(resolvedSearchParams?.process);
  const initialProcessKey =
    PROCESS_TABS.find((process) => process.key === processParam)?.key ?? null;
  const initialQuantity = resolveSearchParam(resolvedSearchParams?.qty);
  const initialNeedByDate = resolveSearchParam(resolvedSearchParams?.needBy);
  const uploadFlag = resolveSearchParam(resolvedSearchParams?.upload);
  const autoOpenUpload = uploadFlag === "1" || uploadFlag === "true";

  return (
    <main className="main-shell">
      <div className="mx-auto max-w-page px-4 sm:px-6 lg:px-8 py-16 sm:py-20 space-y-16">
        {/* HERO */}
        <section className="mx-auto max-w-5xl space-y-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-ink-soft">
            Manufacturing metasearch
          </p>
          <div className="space-y-4">
            <h1 className="text-4xl sm:text-5xl font-semibold text-ink heading-tight">
              Compare manufacturing quotes from top suppliers.
            </h1>
            <p className="text-base text-ink-muted heading-snug">
              Search multiple providers at once. No vendor lock-in.
            </p>
          </div>
          <div className="rounded-3xl border border-slate-900/70 bg-slate-950/60 p-4 shadow-[0_18px_50px_rgba(2,6,23,0.45)] sm:p-6">
            <HomeHeroUploadPanel
              processes={PROCESS_TABS}
              isAuthenticated={isAuthenticated}
              initialProcessKey={initialProcessKey}
              initialQuantity={initialQuantity ?? undefined}
              initialNeedByDate={initialNeedByDate ?? undefined}
              autoOpenUpload={autoOpenUpload}
            />
          </div>
          <div className="flex flex-col gap-2 text-xs text-ink-soft sm:flex-row sm:items-center sm:gap-3">
            {TRUST_SIGNALS.map((signal) => (
              <span key={signal} className="pill pill-muted">
                {signal}
              </span>
            ))}
          </div>
        </section>

        {/* TRUST BLOCKS */}
        <section aria-labelledby="trust-blocks" className="space-y-4">
          <h2 id="trust-blocks" className="sr-only">
            Trust blocks
          </h2>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-3xl border border-slate-900/60 bg-slate-950/70 p-6 shadow-[0_12px_35px_rgba(2,6,23,0.4)]">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink-soft">
                Transparency
              </p>
              <h3 className="mt-3 text-lg font-semibold text-ink heading-tight">
                No favorites in rankings.
              </h3>
              <p className="mt-2 text-sm text-ink-muted heading-snug">
                We don&apos;t play favorites &mdash; results are ranked by value, speed, and
                risk with clear reasoning behind every match.
              </p>
            </div>

            <div className="rounded-3xl border border-slate-900/60 bg-slate-950/70 p-6 shadow-[0_12px_35px_rgba(2,6,23,0.4)]">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink-soft">
                How it works
              </p>
              <h3 className="mt-3 text-lg font-semibold text-ink heading-tight">
                Three quick steps.
              </h3>
              <ol className="mt-4 space-y-3">
                {HOW_IT_WORKS_STEPS.map((step, index) => (
                  <li key={step.title} className="flex gap-3">
                    <span
                      aria-hidden
                      className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-800/80 bg-slate-900/60 text-xs font-semibold text-ink"
                    >
                      {index + 1}
                    </span>
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-ink heading-tight">
                        {step.title}
                      </p>
                      <p className="text-xs text-ink-muted heading-snug">
                        {step.description}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="rounded-3xl border border-slate-900/60 bg-slate-950/70 p-6 shadow-[0_12px_35px_rgba(2,6,23,0.4)]">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink-soft">
                Provider coverage
              </p>
              <h3 className="mt-3 text-lg font-semibold text-ink heading-tight">
                Live network visibility.
              </h3>
              <p className="mt-2 text-sm text-ink-muted heading-snug">
                See which providers are active before you submit.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {activeProviders.length === 0 ? (
                  <span className="text-xs text-ink-soft">
                    Active providers will appear here.
                  </span>
                ) : (
                  activeProviders.map((provider) => {
                    const initials = getProviderInitials(provider.name);

                    return (
                      <div
                        key={provider.id}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-900/70 bg-slate-950/60 px-3 py-1.5 text-xs font-semibold text-ink shadow-[0_8px_20px_rgba(2,6,23,0.35)]"
                      >
                        <span
                          aria-hidden
                          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-700/80 bg-slate-900/70 text-[10px] font-semibold text-slate-200"
                        >
                          {initials}
                        </span>
                        <span>{provider.name}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </section>

      </div>
    </main>
  );
}
