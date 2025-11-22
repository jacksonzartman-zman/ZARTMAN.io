import type { ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";

export type PortalRole = "customer" | "supplier";

const ROLE_COPY: Record<
  PortalRole,
  {
    title: string;
    tagline: string;
    accent: string;
  }
> = {
  customer: {
    title: "Customer workspace",
    tagline: "Track RFQs, quotes, orders, and messages in one place.",
    accent: "text-emerald-300",
  },
  supplier: {
    title: "Supplier workspace",
    tagline: "Manage inbound RFQs and collaborate with customers.",
    accent: "text-blue-300",
  },
};

type PortalLayoutProps = {
  role: PortalRole;
  children: ReactNode;
  userName?: string | null;
};

/**
 * `PortalLayout` centralizes the chrome for role-based portals.
 * Once Supabase auth is in place we can pass the signed-in user's profile
 * into this component to hydrate the avatar block + contextual navigation.
 */
export default function PortalLayout({
  role,
  children,
  userName,
}: PortalLayoutProps) {
  const copy = ROLE_COPY[role];
  const displayName = userName ?? "Guest user";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <header className="border-b border-slate-900 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p
              className={clsx(
                "text-xs font-semibold uppercase tracking-[0.3em]",
                copy.accent,
              )}
            >
              {role} portal
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-white">{copy.title}</h1>
            <p className="text-sm text-slate-400">{copy.tagline}</p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="rounded-full border border-slate-800 px-4 py-2 text-slate-200">
              {displayName}
            </div>
            <Link
              href="/"
              className="rounded-full border border-slate-800 px-4 py-2 text-xs font-semibold text-emerald-300 transition hover:border-emerald-400 hover:text-emerald-200"
            >
              Back to site
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-10 space-y-6">{children}</main>
    </div>
  );
}
