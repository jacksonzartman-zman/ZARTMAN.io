export const dynamic = "force-dynamic";

import UploadBox, { type PrefillContact } from "@/components/UploadBox";
import type { User } from "@supabase/supabase-js";
import { getServerAuthUser } from "@/server/auth";

export default async function QuotePage() {
  const { user } = await getServerAuthUser();
  const prefillContact = buildQuotePrefillContact(user);
  console.log("[quote intake] prefill contact", {
    hasUser: Boolean(user),
    prefillEmail: prefillContact?.email ?? null,
  });

  return (
    <main className="main-shell">
      <div className="mx-auto max-w-page px-4 sm:px-6 lg:px-8 py-16 sm:py-20 space-y-14">
        <section className="max-w-3xl space-y-5">
          <div className="pill pill-success px-4 py-2 text-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
            <span>Upload to get a fast quote</span>
          </div>
          <div className="space-y-4">
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-ink">
              Upload a CAD file to kick off a quote
            </h1>
            <p className="text-sm sm:text-base text-ink-muted">
              Drop STEP, IGES, STL, SolidWorks, or zipped assemblies. Your file
              lands in Supabase storage, metadata syncs to the admin cockpit, and
              we follow up with pricing plus any DFM notes.
            </p>
          </div>
          <div className="rounded-2xl border border-line-subtle bg-surface/50 p-4 text-sm text-ink-soft">
            <p>Need an NDA or have multiple files? Drop the first one here and we&apos;ll reply with the secure follow-up path.</p>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-950/40 p-4 sm:p-6 shadow-lift-sm">
          <UploadBox prefillContact={prefillContact} showExplainer />
        </section>

        <section className="space-y-6">
          <header className="space-y-2">
            <h2 className="text-lg sm:text-xl font-semibold text-ink">
              How it works
            </h2>
            <p className="max-w-copy text-sm text-ink-muted">
              Clear steps so you can go from CAD to PO without a maze of inbox
              threads.
            </p>
          </header>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="surface-card p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                1. Upload
              </div>
              <p className="text-sm text-ink-soft">
                Send one file with context on material, quantity, and deadlines.
              </p>
            </div>
            <div className="surface-card p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                2. Review
              </div>
              <p className="text-sm text-ink-soft">
                We process it in Supabase, inspect geometry, and capture DFM
                questions in your quote workspace.
              </p>
            </div>
            <div className="surface-card p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                3. Decide
              </div>
              <p className="text-sm text-ink-soft">
                Pricing, lead-time ranges, and status updates show up in the admin
                view so your team can move.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function buildQuotePrefillContact(user: User | null): PrefillContact | null {
  if (!user) return null;

  const rawEmail =
    typeof user.email === "string" ? user.email.trim() : "";

  if (!rawEmail) {
    return null;
  }

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;

  const metaName =
    typeof meta.name === "string" ? meta.name.trim() : "";

  const firstNameFromMeta =
    typeof meta.first_name === "string"
      ? meta.first_name
      : typeof meta.given_name === "string"
        ? meta.given_name
        : metaName.split(" ")[0] ?? "";

  const lastNameFromMeta =
    typeof meta.last_name === "string"
      ? meta.last_name
      : typeof meta.family_name === "string"
        ? meta.family_name
        : metaName.split(" ").slice(1).join(" ");

  const firstName = firstNameFromMeta.trim();
  const lastName = lastNameFromMeta.trim();

  const displayName =
    [firstName, lastName].filter(Boolean).join(" ") ||
    metaName ||
    rawEmail;

  return {
    firstName,
    lastName,
    email: rawEmail,
    displayName,
  };
}
