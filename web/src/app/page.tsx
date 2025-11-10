export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white p-8 font-sans">
      <header className="max-w-6xl mx-auto flex items-center justify-between py-8">
        <div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Zartman.io</h1>
          <p className="text-gray-300 mt-2 max-w-2xl">A modern manufacturing platform — centralized quoting, secure file sharing, and supplier orchestration that scales.</p>
        </div>

        <div className="flex items-center gap-3">
          <a className="px-5 py-2 rounded-lg bg-white text-black font-medium" href="#upload">Upload CAD</a>
          <a className="px-4 py-2 rounded-lg border border-zinc-700 text-sm text-gray-200" href="#demo">Schedule Demo</a>
        </div>
      </header>

      <section id="hero" className="max-w-6xl mx-auto grid md:grid-cols-2 gap-10 items-center py-12">
        <div>
          <h2 className="text-3xl md:text-4xl font-semibold">From RFQ to finished part — faster, safer, and auditable.</h2>
          <p className="text-gray-300 mt-4">Upload CAD files, invite stakeholders, and get supplier quotes with traceable material & process notes. No email chains. No missing attachments. Built for precision teams.</p>

          <div className="mt-6 flex gap-4">
            <a id="upload" className="px-6 py-3 bg-white text-black rounded-lg font-medium" href="#">Start an Upload</a>
            <a id="learn" className="px-6 py-3 border border-zinc-700 rounded-lg text-sm text-gray-200" href="#features">Why Zartman</a>
          </div>
        </div>

        <div className="bg-zinc-900 rounded-xl p-6">
          <h3 className="text-lg font-semibold mb-4">Quick Preview</h3>
          <div className="space-y-4">
            <div className="bg-black/40 p-4 rounded-lg">
              <p className="text-sm text-gray-100">Inbox — New RFQ from Jay Logistics</p>
              <p className="text-gray-400 text-sm mt-1">“STL looks good — confirm tolerances and lead time.”</p>
            </div>

            <div className="bg-black/40 p-4 rounded-lg">
              <p className="text-sm text-gray-100">Quote Builder — Impeller Housing</p>
              <div className="flex items-baseline justify-between">
                <div>
                  <p className="text-gray-400 text-sm">5-axis CNC — 6061-T6</p>
                </div>
                <p className="text-green-400 font-semibold">$1,420</p>
              </div>
            </div>

            <div className="bg-black/30 p-3 rounded-lg text-sm text-gray-300">
              <p><strong>Total Estimate:</strong> <span className="text-green-400 font-semibold">$1,740</span></p>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="max-w-6xl mx-auto py-12">
        <h3 className="text-2xl font-semibold mb-6">Features built for manufacturers</h3>
        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-zinc-900 rounded-xl p-6">
            <h4 className="font-semibold">Secure CAD Sharing</h4>
            <p className="text-gray-400 mt-2 text-sm">End-to-end file controls, timestamped access, and per-user permissions for sensitive designs.</p>
          </div>

          <div className="bg-zinc-900 rounded-xl p-6">
            <h4 className="font-semibold">Quote Automation</h4>
            <p className="text-gray-400 mt-2 text-sm">Structured parts, process selections, and supplier packs produce comparable quotes fast.</p>
          </div>

          <div className="bg-zinc-900 rounded-xl p-6">
            <h4 className="font-semibold">Supplier Orchestration</h4>
            <p className="text-gray-400 mt-2 text-sm">Invite, qualify, and assign suppliers with SLAs and audit trails.</p>
          </div>
        </div>
      </section>

      <section id="cta" className="max-w-6xl mx-auto py-12 flex flex-col md:flex-row gap-6 items-center justify-between">
        <div>
          <h4 className="text-xl font-semibold">Ready to remove the back-and-forth?</h4>
          <p className="text-gray-400 mt-2">Start a secure upload and get an instant quote from your approved supplier network.</p>
        </div>

        <div className="flex gap-4">
          <a className="px-6 py-3 bg-white text-black rounded-lg font-medium" href="#">Upload CAD</a>
          <a className="px-6 py-3 border border-zinc-700 rounded-lg text-sm text-gray-200" href="#demo">Contact Sales</a>
        </div>
      </section>

      <footer className="max-w-6xl mx-auto py-8 text-sm text-gray-500">
        <div className="flex justify-between">
          <span>© {new Date().getFullYear()} Zartman.io</span>
          <span>Privacy · Terms</span>
        </div>
      </footer>
    </main>
  );
}
