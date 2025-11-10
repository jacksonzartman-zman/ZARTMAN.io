export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-zinc-950 text-zinc-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(244,244,255,0.08),_rgba(24,24,27,0.9))]" />
      <main className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-16 px-6 py-16 font-sans sm:px-10 lg:gap-24 lg:py-24">
        <section className="grid grid-cols-1 gap-12 lg:grid-cols-[1.05fr_1fr] lg:items-center">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-zinc-300">
              Manufacturing OS
            </div>
            <div className="space-y-6">
              <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
                Zartman.io powers the modern manufacturing platform.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-zinc-300 sm:text-xl">
                Centralize quoting, collaboration, and supplier orchestration. Upload secure CAD
                files, align teams instantly, and deliver precision parts without the back-and-forth.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                className="group inline-flex items-center justify-center rounded-full bg-zinc-50 px-6 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-white"
              >
                Upload your CAD
                <span className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-xs text-zinc-50 transition group-hover:bg-zinc-950">
                  ↗
                </span>
              </button>
              <span className="text-sm text-zinc-400">
                Encrypted by default. Share only with approved suppliers.
              </span>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.8)] backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-200">
                    Inbox
                  </h3>
                  <p className="text-xs text-zinc-400">Secure messaging with your supply chain</p>
                </div>
                <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
                  Live
                </span>
              </div>
              <div className="mt-5 space-y-3 text-sm text-zinc-300">
                <div className="grid grid-cols-[auto,1fr] items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.05] px-4 py-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-200">
                    JL
                  </div>
                  <div className="flex flex-col">
                    <span className="font-medium text-zinc-100">Jay Logistics</span>
                    <span className="text-xs text-zinc-400">
                      “RFQ received. STL looks clean. Confirm tolerances?”
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-[auto,1fr] items-center gap-3 rounded-2xl border border-white/5 px-4 py-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-200">
                    AM
                  </div>
                  <div className="flex flex-col">
                    <span className="font-medium text-zinc-100">AeroMach</span>
                    <span className="text-xs text-zinc-400">
                      “Material certs uploaded. Ready for sign-off.”
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-[auto,1fr] items-center gap-3 rounded-2xl border border-dashed border-white/10 px-4 py-3 text-zinc-500">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-xs">
                    +
                  </div>
                  <span className="text-xs font-medium uppercase tracking-[0.2em]">
                    New message preview
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-200">
                    Quote Builder
                  </h3>
                  <p className="text-xs text-zinc-400">Generate pricing in minutes</p>
                </div>
                <span className="text-xs font-medium text-zinc-500">Draft · V2</span>
              </div>
              <div className="mt-5 space-y-4 text-sm">
                <div className="flex items-center justify-between rounded-2xl border border-white/5 bg-white/[0.04] px-4 py-3">
                  <div>
                    <p className="font-medium text-zinc-100">Impeller Housing</p>
                    <p className="text-xs text-zinc-400">5-axis CNC · 6061-T6</p>
                  </div>
                  <span className="text-sm font-semibold text-zinc-100">$1,420</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-white/5 px-4 py-3">
                  <div>
                    <p className="font-medium text-zinc-100">QA & Post-Processing</p>
                    <p className="text-xs text-zinc-400">Anodize + dimensional check</p>
                  </div>
                  <span className="text-sm font-semibold text-zinc-100">$320</span>
                </div>
                <div className="flex items-center justify-between border-t border-white/10 pt-3 text-xs uppercase tracking-[0.2em] text-zinc-400">
                  <span>Total estimated</span>
                  <span className="text-sm font-semibold text-zinc-100">$1,740</span>
                </div>
              </div>
              <div className="mt-6 flex items-center justify-between rounded-2xl border border-dashed border-white/10 px-4 py-3 text-xs text-zinc-400">
                <span>Add supplier markup, payment terms, lead time…</span>
                <span className="text-zinc-500">Coming soon</span>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-10">
          <div className="flex flex-col gap-4">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-100 sm:text-3xl">
              Everything your team needs in one platform
            </h2>
            <p className="max-w-3xl text-base text-zinc-400">
              Streamlined workflows keep engineers, operations, and suppliers aligned. Zartman.io was
              designed to replace ad-hoc spreadsheets and late-night email threads.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <div className="group space-y-3 rounded-3xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-white/20 hover:bg-white/[0.05]">
              <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-zinc-300">
                Quotes
              </h3>
              <p className="text-sm leading-6 text-zinc-400">
                Build configuration-driven estimates, compare supplier pricing, and publish RFQs
                instantly.
              </p>
              <div className="text-xs font-semibold uppercase tracking-[0.3em] text-zinc-500">
                Version history · Approval flows
              </div>
            </div>
            <div className="group space-y-3 rounded-3xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-white/20 hover:bg-white/[0.05]">
              <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-zinc-300">
                Messaging
              </h3>
              <p className="text-sm leading-6 text-zinc-400">
                Centralize conversations, share drawings securely, and keep every change tracked with
                audit-ready logs.
              </p>
              <div className="text-xs font-semibold uppercase tracking-[0.3em] text-zinc-500">
                Secure threads · Attachments
              </div>
            </div>
            <div className="group space-y-3 rounded-3xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-white/20 hover:bg-white/[0.05]">
              <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-zinc-300">
                Suppliers
              </h3>
              <p className="text-sm leading-6 text-zinc-400">
                Manage partner performance, compliance, and capacity from a single source of truth.
              </p>
              <div className="text-xs font-semibold uppercase tracking-[0.3em] text-zinc-500">
                Scorecards · Certifications
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
