import { getActiveProviders } from "@/server/providers";
import { getServerAuthUser } from "@/server/auth";
import { HomeUploadHero } from "@/components/marketing/HomeUploadHero";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  searchParams?: Promise<SearchParams>;
};

const HOW_IT_WORKS_STEPS = [
  {
    title: "Upload",
    description: "Share CAD/ZIP, quantities, and the date you need parts.",
  },
  {
    title: "Compare offers",
    description: "Review price and lead-time ranges across multiple suppliers.",
  },
  {
    title: "We connect you",
    description: "Request introductions only when you’re ready to move forward.",
  },
];

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

export default async function HomePage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const activeProviders = await getActiveProviders();
  // Keep auth lookup available for downstream sections, but homepage upload is anonymous-first.
  await getServerAuthUser({ quiet: true });
  void sp;

  return (
    <main className="main-shell">
      <div className="mx-auto max-w-page px-4 sm:px-6 lg:px-8 py-14 sm:py-16 space-y-14 sm:space-y-16">
        {/* HERO */}
        <section className="relative mx-auto max-w-5xl space-y-8 sm:space-y-10">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -top-10 -bottom-12 rounded-[52px] bg-[radial-gradient(80%_60%_at_50%_0%,rgba(16,185,129,0.12),transparent_60%),linear-gradient(to_bottom,rgba(2,6,23,0.55),rgba(2,6,23,0.08),transparent)] ring-1 ring-slate-900/40"
          />
          <div className="relative">
            <HomeUploadHero />
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section aria-labelledby="how-it-works" className="space-y-6">
          <header className="space-y-2">
            <h2 id="how-it-works" className="text-2xl font-semibold text-ink heading-tight">
              How it works
            </h2>
            <p className="text-sm text-ink-muted heading-snug">
              Three steps from CAD to connected suppliers.
            </p>
          </header>
          <ol className="grid gap-4 sm:grid-cols-3">
            {HOW_IT_WORKS_STEPS.map((step, index) => (
              <li
                key={step.title}
                className="rounded-3xl border border-slate-900/50 bg-slate-950/40 p-6 shadow-[0_10px_28px_rgba(2,6,23,0.28)]"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink-soft">
                  Step {index + 1}
                </p>
                <h3 className="mt-3 text-lg font-semibold text-ink heading-tight">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm text-ink-muted heading-snug">{step.description}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* TRUST SIGNALS */}
        <section aria-labelledby="trust-signals" className="space-y-4">
          <h2 id="trust-signals" className="sr-only">
            Trust signals
          </h2>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-3xl border border-slate-900/60 bg-slate-950/70 p-6 shadow-[0_12px_35px_rgba(2,6,23,0.4)]">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink-soft">
                Verified suppliers
              </p>
              <h3 className="mt-3 text-lg font-semibold text-ink heading-tight">
                Customer-safe validation.
              </h3>
              <p className="mt-2 text-sm text-ink-muted heading-snug">
                “Verified” means we&apos;ve confirmed identity and capabilities before we
                recommend a supplier.
              </p>
            </div>

            <div className="rounded-3xl border border-slate-900/60 bg-slate-950/70 p-6 shadow-[0_12px_35px_rgba(2,6,23,0.4)]">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink-soft">
                Privacy-first
              </p>
              <h3 className="mt-3 text-lg font-semibold text-ink heading-tight">
                No broad file sharing.
              </h3>
              <p className="mt-2 text-sm text-ink-muted heading-snug">
                We don&apos;t publish your files to a marketplace. You request intros, and
                we connect you to the suppliers you choose.
              </p>
            </div>

            <div className="rounded-3xl border border-slate-900/60 bg-slate-950/70 p-6 shadow-[0_12px_35px_rgba(2,6,23,0.4)]">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink-soft">
                Coverage
              </p>
              <h3 className="mt-3 text-lg font-semibold text-ink heading-tight">
                Live network visibility.
              </h3>
              <p className="mt-2 text-sm text-ink-muted heading-snug">
                See a snapshot of suppliers currently available.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {activeProviders.length === 0 ? (
                  <span className="text-xs text-ink-soft">Active suppliers will appear here.</span>
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
