import UploadBox from "@/components/UploadBox";

export default function HomePage() {
  return (
    <main className="main-shell">
      <div className="mx-auto max-w-page px-4 sm:px-6 lg:px-8 py-16 sm:py-20 space-y-16">
        {/* HERO */}
        <section className="grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-center">
          <div className="space-y-6">
            <div className="badge-soft">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              <span>Manufacturing OS for real-world parts</span>
            </div>

            <div className="space-y-4">
              <h1 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-ink">
                Zartman.io
              </h1>
              <p className="max-w-copy text-sm sm:text-base text-ink-muted">
                From CAD file to manufacturing quote, without the runaround.
                One front door for quotes, DFM feedback, and supplier
                coordination — built for engineers who live in the real world,
                not in sales funnels.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <a
                href="#upload"
                className="inline-flex items-center justify-center rounded-pill bg-brand px-6 py-2 text-sm font-semibold text-ink shadow-lift-sm hover:bg-brand-soft transition-colors"
              >
                Upload a CAD file
              </a>
              <p className="text-xs sm:text-sm text-ink-muted">
                STEP, IGES, STL, SolidWorks &amp; zipped assemblies. No spam, no
                nurture sequence.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3 text-xs sm:text-sm">
              <div className="surface-card p-4 shadow-lift-sm">
                <p className="text-ink-soft font-medium mb-1">For real work</p>
                <p className="text-ink-muted">
                  Production, service parts, and weird one-offs that don&apos;t
                  fit in a dropdown.
                </p>
              </div>
              <div className="surface-card p-4 shadow-lift-sm">
                <p className="text-ink-soft font-medium mb-1">
                  Built from war stories
                </p>
                <p className="text-ink-muted">
                  Lessons from thousands of jobs at Protolabs, Hubs, and
                  friends-of-the-industry.
                </p>
              </div>
              <div className="surface-card p-4 shadow-lift-sm">
                <p className="text-ink-soft font-medium mb-1">
                  Not another portal
                </p>
                <p className="text-ink-muted">
                  One place to drop context, not another login you&apos;ll
                  forget.
                </p>
              </div>
            </div>
          </div>

          {/* Right side: upload box pulled up into hero */}
          <div className="lg:pl-4">
            <UploadBox />
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="space-y-6">
          <header className="space-y-2">
            <h2 className="text-lg sm:text-xl font-semibold text-ink">
              How it works
            </h2>
            <p className="max-w-copy text-sm text-ink-muted">
              You send one file with a bit of context. We translate that into a
              realistic path to parts-in-hand — with options, not fluff.
            </p>
          </header>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="surface-card p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                1. Upload
              </div>
              <p className="text-sm text-ink-soft">
                Drop in your CAD and a short note about volumes, timelines, and
                what &quot;good&quot; looks like for you.
              </p>
            </div>
            <div className="surface-card p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                2. Review
              </div>
              <p className="text-sm text-ink-soft">
                We review manufacturability, flag risk areas, and line up
                realistic options — not fantasy lead times.
              </p>
            </div>
            <div className="surface-card p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                3. Decide
              </div>
              <p className="text-sm text-ink-soft">
                You get an honest, actionable plan: pricing signals, lead times,
                and clear next steps so you can move.
              </p>
            </div>
          </div>
        </section>

        {/* WHY THIS EXISTS */}
        <section className="space-y-4 max-w-copy">
          <h2 className="text-lg sm:text-xl font-semibold text-ink">
            Why this exists
          </h2>
          <p className="text-sm sm:text-base text-ink-soft">
            Modern manufacturing workflows are fragmented: one portal for
            quotes, one inbox thread for DFM, one spreadsheet for suppliers.
            Zartman.io is a single front door for the messy part in the middle —
            getting from CAD to parts without losing context or time.
          </p>
          <p className="text-sm sm:text-base text-ink-muted">
            This isn&apos;t about replacing your suppliers. It&apos;s about
            giving you a simple way to point at a file and say, &quot;Here&apos;s
            what I&apos;m trying to do. Help me make it real.&quot;
          </p>
        </section>

        {/* UPLOAD SECTION ANCHOR (for the hero CTA link) */}
        <section id="upload">
          {/* We already render UploadBox in the hero on desktop.
              This anchor makes sure the "Upload a CAD file" button scrolls
              users close to the flow on smaller screens. */}
        </section>

        {/* FOOTER */}
        <footer className="border-t border-line-subtle pt-6 text-xs text-ink-muted flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <p>
            Built by Zartman. Informed by too many manufacturing war stories to
            count.
          </p>
          <p className="text-[11px] text-ink-muted">
            Early experimental version. If you&apos;re curious, email or DM and
            we&apos;ll talk shop.
          </p>
        </footer>
      </div>
    </main>
  );
}