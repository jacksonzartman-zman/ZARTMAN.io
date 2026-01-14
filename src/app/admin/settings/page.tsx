export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  return (
    <main className="mx-auto w-full max-w-page px-4 py-10 sm:px-6 lg:px-8">
      <section className="rounded-3xl border border-slate-900 bg-slate-950/70 p-8 shadow-[0_18px_40px_rgba(2,6,23,0.65)]">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-300">
          Admin
        </p>
        <h1 className="mt-4 text-3xl font-semibold text-white">Settings</h1>
        <p className="mt-3 text-sm text-slate-300">
          Admin settings are not configured yet.
        </p>
      </section>
    </main>
  );
}

