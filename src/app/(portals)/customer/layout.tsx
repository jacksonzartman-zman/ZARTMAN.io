import type { ReactNode } from "react";
import Link from "next/link";
import PortalLayout from "../PortalLayout";
import { getServerAuthUser } from "@/server/auth";

export default async function CustomerPortalLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { user } = await getServerAuthUser();
  console.log("[customer layout] server session email:", user?.email ?? null);

  if (!user) {
    return (
      <PortalLayout>
        <section className="mx-auto max-w-2xl rounded-3xl border border-slate-900 bg-slate-950/70 p-8 text-center shadow-[0_18px_40px_rgba(2,6,23,0.85)]">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-300">
            Customer workspace
          </p>
          <h1 className="mt-4 text-3xl font-semibold text-white">You&apos;re not logged in</h1>
          <p className="mt-3 text-sm text-slate-300">
            Use your work email to request a magic link to your customer workspace. We&apos;ll send
            you right back to this dashboard.
          </p>
          <Link
            href="/login?next=/customer"
            className="mt-6 inline-flex items-center justify-center rounded-full bg-white/90 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-white"
          >
            Go to login
          </Link>
        </section>
      </PortalLayout>
    );
  }

  return <PortalLayout>{children}</PortalLayout>;
}
