"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SHOW_SUPPLIER_DIRECTORY_PUBLIC } from "@/lib/ui/deprecation";

type FooterLink = {
  label: string;
  href: string;
  description?: string;
};

const SUPPLIER_DIRECTORY_LINKS: FooterLink[] = SHOW_SUPPLIER_DIRECTORY_PUBLIC
  ? [
      { label: "Suppliers", href: "/suppliers" },
      { label: "Join as Supplier", href: "/suppliers/join" },
    ]
  : [];

const FOOTER_COLUMNS: {
  title: string;
  links: FooterLink[];
}[] = [
  {
    title: "Marketplace",
    links: [
      { label: "Search suppliers", href: "/customer/search" },
      ...SUPPLIER_DIRECTORY_LINKS,
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "FAQ", href: "/faq" },
      { label: "Contact", href: "/contact" },
      { label: "Privacy", href: "/privacy" },
    ],
  },
];

export default function SiteFooter() {
  const pathname = usePathname();
  if (pathname?.startsWith("/provider/offer")) {
    return null;
  }

  return (
    <footer className="border-t border-slate-900/70 bg-neutral-950/90">
      <div className="mx-auto max-w-page px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-8 sm:grid-cols-2">
          {FOOTER_COLUMNS.map((column) => (
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
