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
      </div>
    </main>
  );
}
