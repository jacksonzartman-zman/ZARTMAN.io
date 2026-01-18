"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type FooterLink = {
  label: string;
  href: string;
  description?: string;
};

const FOOTER_COLUMNS: {
  title: string;
  links: FooterLink[];
}[] = [
  {
    title: "Customers",
    links: [
      { label: "Customer portal", href: "/customer" },
      {
        label: "Become a customer",
        href: "/customer/signup",
        description:
          "Create your workspace and send your first RFQ.",
      },
    ],
  },
  {
    title: "Suppliers",
    links: [
      { label: "Supplier portal", href: "/supplier" },
      {
        label: "Supplier directory",
        href: "/suppliers",
        description: "Browse vetted suppliers by process and location.",
      },
      {
        label: "Become a supplier",
        href: "/supplier/signup",
        description:
          "Create a supplier profile and get a magic link to finish onboarding.",
      },
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
        <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-3">
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
