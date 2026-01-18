'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";
import { primaryCtaClasses } from "@/lib/ctas";
import { BrandMark } from "@/components/BrandMark";

const CENTER_LINKS = [
  { label: "Capabilities", href: "/capabilities" },
  { label: "Suppliers", href: "/suppliers" },
  { label: "Resources", href: "/resources" },
];

export default function SiteHeader() {
  const pathname = usePathname();
  const isSupplierPortal = pathname === "/supplier" || pathname?.startsWith("/supplier/");
  if (pathname?.startsWith("/customer") || isSupplierPortal || pathname?.startsWith("/provider/offer")) {
    return null;
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-900/70 bg-neutral-950/90 backdrop-blur-md">
      <div className="mx-auto grid w-full max-w-page grid-cols-1 gap-4 px-4 py-4 sm:px-6 md:grid-cols-[auto_minmax(0,1fr)_auto] lg:px-8">
        <BrandMark
          withWordmark
          subLabel="Marketplace"
          size={32}
          className="text-base font-semibold text-ink transition-colors hover:text-ink-soft"
        />

        <nav className="flex flex-wrap items-center justify-center gap-4 text-sm font-medium text-ink-soft md:justify-center">
          {CENTER_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="transition-colors hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <nav className="flex flex-wrap items-center justify-start gap-3 text-sm font-medium text-ink-soft md:justify-end">
          <Link
            href="/login"
            className="rounded-full px-3 py-1.5 text-ink-soft transition-colors hover:text-ink"
          >
            Log in
          </Link>
          <Link href="/customer/search" className={primaryCtaClasses}>
            Search suppliers
          </Link>
        </nav>
      </div>
    </header>
  );
}
