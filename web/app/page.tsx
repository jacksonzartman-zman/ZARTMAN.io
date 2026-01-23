import CadUpload from "@/components/CadUpload";

export default function Page() {
  return (
    <main
      className="min-h-[calc(100vh-3.5rem)]"
      style={{
        background:
          "radial-gradient(circle at top, rgba(39, 75, 211, 0.22), rgba(9, 10, 13, 0.95))",
      }}
    >
      <section className="mx-auto max-w-page px-4 pb-14 pt-14 text-center md:pt-18">
        <header className="mx-auto grid max-w-copy gap-4">
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
            Find suppliers for your part, fast
          </h1>
          <p className="text-base text-ink/muted md:text-lg">
            Upload a CAD file to share quote requests, collaborate with suppliers, and deliver parts
            faster.
          </p>
        </header>

        <div id="suppliers" className="mt-10 flex justify-center">
          <CadUpload />
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-page px-4 pb-16">
        <div className="mx-auto grid max-w-copy gap-4 rounded-2xl bg-white/5 p-6 md:p-8">
          <h2 className="text-xl font-semibold tracking-tight">How it works</h2>
          <ol className="grid gap-3 text-sm text-ink/80 md:text-base">
            <li className="rounded-xl bg-white/5 px-4 py-3">
              <span className="font-semibold text-ink">1)</span> Upload a CAD file.
            </li>
            <li className="rounded-xl bg-white/5 px-4 py-3">
              <span className="font-semibold text-ink">2)</span> Share it with suppliers for quotes.
            </li>
            <li className="rounded-xl bg-white/5 px-4 py-3">
              <span className="font-semibold text-ink">3)</span> Review responses and keep everything in
              one thread.
            </li>
          </ol>
        </div>
      </section>
    </main>
  );
}
