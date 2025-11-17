import UploadBox from "@/components/UploadBox";

const steps = [
  "Upload your CAD file",
  "We review manufacturability & options",
  "You get a clear path to parts in production",
];

export default function Page() {
  return (
    <main className="bg-gray-50 text-gray-900">
      <div className="container mx-auto max-w-6xl px-6 py-16 space-y-24">
        <section className="text-center space-y-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-gray-500">
            Zartman Manufacturing OS
          </p>
          <h1 className="text-4xl md:text-6xl font-bold text-gray-900">
            Zartman.io
          </h1>
          <p className="text-lg md:text-2xl text-gray-700 max-w-3xl mx-auto">
            From CAD file to manufacturing quote, without the runaround.
          </p>
          <button
            className="inline-flex items-center justify-center rounded-full bg-gray-900 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-gray-900/20 transition hover:-translate-y-0.5"
            onClick={() => {
              const uploadSection = document.getElementById("upload-section");
              uploadSection?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            Upload CAD file
          </button>
        </section>

        <section className="space-y-8" aria-labelledby="how-it-works-heading">
          <div className="space-y-2 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gray-500">
              How it works
            </p>
            <h2
              id="how-it-works-heading"
              className="text-3xl font-bold text-gray-900"
            >
              A clear path from file to parts
            </h2>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {steps.map((step, index) => (
              <div
                key={step}
                className="rounded-2xl border border-gray-200 bg-white p-6 text-left shadow-sm"
              >
                <p className="text-sm font-semibold text-gray-500">
                  Step {index + 1}
                </p>
                <p className="mt-3 text-lg font-medium text-gray-900">
                  {step}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-8 rounded-3xl bg-white/70 p-10 shadow-inner shadow-gray-200 md:grid-cols-2">
          <div className="space-y-4">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-gray-500">
              Why this exists
            </p>
            <h2 className="text-3xl font-bold text-gray-900">
              Modern manufacturing needs a front door
            </h2>
            <p className="text-gray-700 leading-relaxed">
              Most manufacturing workflows are still fragmented across inboxes,
              ad hoc portals, and tribal knowledge. Zartman.io is a simple,
              OS-style front door: you share a CAD file, we return manufacturability
              clarity and a playbook to get parts into production without the
              endless back-and-forth.
            </p>
          </div>
          <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-8 text-gray-700">
            <p className="font-semibold text-gray-900">What you can expect</p>
            <ul className="mt-4 space-y-3 text-sm leading-relaxed">
              <li>• Fast, actionable feedback on your design.</li>
              <li>• Transparent manufacturing options and timelines.</li>
              <li>• A single thread to take parts from speculation to production.</li>
            </ul>
          </div>
        </section>

        <section
          id="upload-section"
          className="rounded-3xl bg-white p-8 shadow-xl shadow-gray-200"
        >
          <UploadBox />
        </section>
      </div>
    </main>
  );
}
 