"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getPublicNavConfig } from "@/lib/ui/publicNav";

const PUBLIC_NAV = getPublicNavConfig();

export default function SiteFooter() {
  const pathname = usePathname();
  if (pathname?.startsWith("/provider/offer")) {
    return null;
  }

  return (
    <footer className="border-t border-slate-900/70 bg-neutral-950/90">
      <div className="mx-auto max-w-page px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-8 sm:grid-cols-2">
          {PUBLIC_NAV.footerColumns.map((column) => (
            <div key={column.title} className="space-y-3">
              <p className="text-sm font-semibold uppercase tracking-wide text-ink">
                {column.title}
              </p>
              <ul className="space-y-2 text-sm text-ink-soft">
                {column.links.map((link) => (
                  <li key={link.href} className="space-y-1">
                    <Link
                      href={link.href}
                      className="transition-colors hover:text-ink"
                    >
                      {link.label}
                    </Link>
                    {link.description ? (
                      <p className="text-xs text-ink-muted">{link.description}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 text-xs text-ink-muted">
          Built for manufacturing teams navigating both customer demand and
          supplier capacity — one shared cockpit, no duct tape.
        </div>
      </div>
    </footer>
  );
}
