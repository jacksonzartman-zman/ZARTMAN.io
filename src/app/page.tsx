import UploadBox from "@/components/UploadBox";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-white text-neutral-900">
      <div className="mx-auto flex max-w-5xl flex-col gap-16 px-4 py-16 sm:px-6 lg:px-8">
        {/* Hero */}
        <section className="space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-1 text-sm font-medium text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Manufacturing OS for real-world parts
          </div>
          <div className="space-y-4">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
              Zartman.io
            </h1>
            <p className="max-w-2xl text-base text-neutral-600 sm:text-lg">
              From CAD file to manufacturing quote, without the runaround. One front
              door for quotes, DFM feedback, and supplier coordination.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <a
              href="#upload"
              className="inline-flex items-center justify-center rounded-full bg-emerald-500 px-6 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-600"
            >
              Upload CAD file
            </a>
            <p className="text-xs text-neutral-500 sm:text-sm">
              STEP, IGES, STL, SolidWorks &amp; more. No spam, no newsletter.
            </p>
          </div>
        </section>

        {/* How it works */}
        <section className="space-y-6">
          <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
            How it works
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm">
              <div className="mb-2 text-xs font-semibold uppercase text-neutral-500">
                1. Upload
              </div>
              <p className="text-neutral-700">
                Drop in your CAD and a note about volumes, timelines, and priorities.
              </p>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm">
              <div className="mb-2 text-xs font-semibold uppercase text-neutral-500">
                2. Review
              </div>
              <p className="text-neutral-700">
                We review manufacturability, flag risks, and line up realistic paths to
                parts in hand.
              </p>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm">
              <div className="mb-2 text-xs font-semibold uppercase text-neutral-500">
                3. Decide
              </div>
              <p className="text-neutral-700">
                You get an honest, actionable plan: pricing signals, lead times, and
                suggested next steps.
              </p>
            </div>
          </div>
        </section>

        {/* Why this exists */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
            Why this exists
          </h2>
          <p className="max-w-3xl text-sm text-neutral-700 sm:text-base">
            Modern manufacturing workflows are fragmented: one portal for quotes, one
            inbox thread for DFM, one spreadsheet for suppliers. Zartman.io is a
            single point of entry for the messy part in the middle – getting from
            CAD to parts without losing context or time.
          </p>
        </section>

        {/* Upload section */}
        <section id="upload" className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
            Upload your CAD
          </h2>
          <p className="text-sm text-neutral-600 sm:text-base">
            Start with one file. We&apos;ll use this to tune the flow, not to spam
            you with sales outreach.
          </p>
          <UploadBox />
        </section>

        {/* Footer */}
        <footer className="border-t border-neutral-200 pt-6 text-xs text-neutral-500">
          Built by Zartman, powered by too many manufacturing war stories to count.
        </footer>
      </div>
    </main>
  );
}
 