export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <h1 className="text-4xl md:text-6xl font-semibold tracking-tight">
          Zartman.io powers the modern manufacturing platform.
        </h1>
        <p className="mt-6 max-w-2xl text-zinc-300">
          Centralize quoting, collaboration, and supplier orchestration. Upload secure CAD files,
          align teams instantly, and deliver precision parts without the back-and-forth.
        </p>
        <div className="mt-10">
          <a
            href="#"
            className="inline-flex items-center rounded-md bg-emerald-500 px-5 py-3 font-medium text-black hover:bg-emerald-400"
          >
            Upload your CAD
          </a>
        </div>
      export default function Home() {
        return (
          <main className="min-h-dvh bg-[#0b0f11] text-white">
            <div className="mx-auto max-w-6xl px-6 py-14">
              {/* Top bar */}
              <div className="mb-10 flex items-center justify-between">
                <div className="text-sm/6 text-white/70">Mon Nov 10</div>
                <div className="rounded-full bg-white/5 px-3 py-1 text-xs text-white/70">
                  zartman.io
                </div>
              </div>

              <div className="grid gap-8 md:grid-cols-2">
                {/* Left: hero */}
                <section>
                  <p className="mb-4 text-xs tracking-widest text-white/50">
                    MANUFACTURING OS
                  </p>
                  <h1 className="mb-6 text-5xl font-semibold tracking-tight">
                    Zartman.io powers the modern manufacturing platform.
                  </h1>
                  <p className="mb-8 max-w-xl text-white/70">
                    Centralize quoting, collaboration, and supplier orchestration.
                    Upload secure CAD files, align teams instantly, and deliver
                    precision parts without the back-and-forth.
                  </p>

                  <div className="flex items-center gap-3">
                    <label className="relative inline-flex cursor-pointer items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
                      <input type="file" className="absolute inset-0 cursor-pointer opacity-0" />
                      <span className="inline-flex size-2 items-center justify-center rounded-full bg-emerald-400/90"></span>
                      Upload your CAD
                    </label>
                    <span className="text-xs text-white/50">
                      Encrypted by default. Share only with approved suppliers.
                    </span>
                  </div>
                </section>

                {/* Right: cards */}
                <section className="flex flex-col gap-6">
                  {/* Inbox */}
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                    <div className="mb-4 flex items-center justify-between">
                      <div className="text-xs font-semibold tracking-widest text-white/60">
                        INBOX
                      </div>
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
                        Live
                      </span>
                    </div>

                    <div className="space-y-3">
                      <div className="rounded-xl bg-white/5 p-4">
                        <div className="mb-1 text-sm font-medium">Jay Logistics</div>
                        <p className="text-xs text-white/60">
                          “RFQ received, STL looks clean. Confirm tolerances?”
                        </p>
                      </div>

                      <div className="rounded-xl bg-white/5 p-4">
                        <div className="mb-1 text-sm font-medium">AeroMach</div>
                        <p className="text-xs text-white/60">
                          “Material certs uploaded. Ready for sign-off.”
                        </p>
                      </div>

                      <button className="mt-1 w-full rounded-xl border border-dashed border-white/15 p-4 text-left text-xs text-white/50 hover:bg-white/5">
                        + New message
                      </button>
                    </div>
                  </div>

                  {/* Quote builder */}
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                    <div className="mb-4 text-xs font-semibold tracking-widest text-white/60">
                      QUOTE BUILDER
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between rounded-xl bg-white/5 p-4">
                        <div>
                          <div className="text-sm font-medium">Impeller Housing</div>
                          <div className="text-[11px] text-white/50">
                            5-axis CNC · 6061-T6
                          </div>
                        </div>
                        <div className="text-sm font-semibold">$1,420</div>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-white/5 p-4">
                        <div>
                          <div className="text-sm font-medium">QA &amp; Post-Processing</div>
                          <div className="text-[11px] text-white/50">
                            Anodize + dimensional check
                          </div>
                        </div>
                        <div className="text-sm font-semibold">$320</div>
                      </div>
                      <div className="flex items-center justify-between border-t border-white/10 pt-3 text-xs">
                        <span className="text-white/60">TOTAL ESTIMATED</span>
                        <span className="text-base font-semibold">$1,740</span>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </main>
        );
      }
