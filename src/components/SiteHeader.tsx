'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";
import { primaryCtaClasses } from "@/lib/ctas";
import { getPublicNavConfig } from "@/lib/ui/publicNav";
import { BrandMark } from "@/components/BrandMark";

const PUBLIC_NAV = getPublicNavConfig();

export default function SiteHeader() {
  const pathname = usePathname() ?? "/";
  const isSupplierSignup = pathname.startsWith("/supplier/signup");
  const isSupplierPortal =
    !isSupplierSignup && (pathname === "/supplier" || pathname.startsWith("/supplier/"));
  const isCustomerPortal = pathname.startsWith("/customer");
  const isAdminRoute = pathname.startsWith("/admin");
  const isProviderOfferRoute = pathname.startsWith("/provider/offer");

  if (isCustomerPortal || isSupplierPortal || isAdminRoute || isProviderOfferRoute) {
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

        {PUBLIC_NAV.headerLinks.length > 0 ? (
          <nav className="flex flex-wrap items-center justify-center gap-4 text-sm font-medium text-ink-soft md:justify-center">
            {PUBLIC_NAV.headerLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="transition-colors hover:text-ink"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        ) : null}

        <nav className="flex flex-wrap items-center justify-start gap-3 text-sm font-medium text-ink-soft md:justify-end">
          <Link href={PUBLIC_NAV.primaryCta.href} className={primaryCtaClasses}>
            {PUBLIC_NAV.primaryCta.label}
          </Link>
          <Link
            href={PUBLIC_NAV.authLink.href}
            className="rounded-full px-3 py-1.5 text-ink-soft transition-colors hover:text-ink"
          >
            {PUBLIC_NAV.authLink.label}
          </Link>
        </nav>
      </div>
    </header>
  );
}
