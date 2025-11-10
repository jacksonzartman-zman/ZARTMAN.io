export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white p-8 font-sans">
      <section className="max-w-5xl mx-auto py-16">
        <h1 className="text-5xl font-semibold mb-4">Zartman.io powers the modern manufacturing platform.</h1>
        <p className="text-lg text-gray-300 max-w-2xl">
          Centralize quoting, collaboration, and supplier orchestration. Upload secure CAD files, align teams instantly, and deliver precision parts without the back-and-forth.
        </p>

        <button className="mt-8 px-6 py-3 bg-white text-black rounded-lg text-lg font-medium">
          Upload your CAD
        </button>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">

        {/* Inbox Preview */}
        <div className="bg-zinc-900 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4">Inbox</h2>
          <div className="space-y-4">
            <div className="bg-black/40 p-4 rounded-lg">
              <p className="text-sm text-gray-100">Jay Logistics</p>
              <p className="text-gray-400 text-sm">“RFQ received — STL looks clean. Confirm tolerances?”</p>
            </div>

            <div className="bg-black/40 p-4 rounded-lg">
              <p className="text-sm text-gray-100">AeroMach</p>
              <p className="text-gray-400 text-sm">“Material certs uploaded. Ready for sign-off.”</p>
            </div>
          </div>
        </div>

        {/* Quote Builder Preview */}
        <div className="bg-zinc-900 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4">Quote Builder</h2>

          <div className="bg-black/40 p-4 rounded-lg mb-3">
            <p className="text-gray-100">Impeller Housing</p>
            <p className="text-gray-400 text-sm">5-axis CNC — 6061-T6</p>
            <p className="text-green-400 font-semibold mt-2">$1,420</p>
          </div>

          <div className="bg-black/40 p-4 rounded-lg">
            <p className="text-gray-100">QA & Post-Processing</p>
            <p className="text-gray-400 text-sm">Anodize + dimensional check</p>
            <p className="text-green-400 font-semibold mt-2">$320</p>
          </div>

          <p className="mt-4 font-semibold text-lg">Total Estimated: $1,740</p>
        </div>
      </section>
    </main>
  );
}
