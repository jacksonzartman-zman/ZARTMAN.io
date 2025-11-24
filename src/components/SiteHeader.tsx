import Link from "next/link";
import { primaryCtaClasses } from "@/lib/ctas";

const CENTER_LINKS = [
  { label: "Capabilities", href: "/capabilities" },
  { label: "Resources", href: "/resources" },
];

const RIGHT_LINKS = [
  { label: "Customer portal", href: "/customer" },
  { label: "Supplier portal", href: "/supplier" },
];

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-900/70 bg-neutral-950/90 backdrop-blur-md">
      <div className="mx-auto grid w-full max-w-page grid-cols-1 gap-4 px-4 py-4 sm:px-6 md:grid-cols-[auto_minmax(0,1fr)_auto] lg:px-8">
        <Link
          href="/"
          className="flex items-center gap-3 text-base font-semibold text-ink transition-colors hover:text-ink-soft"
          aria-label="Zartman front door"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-emerald-400/50 bg-emerald-400/10 text-sm font-bold uppercase tracking-wide text-emerald-200">
            Z
          </span>
          <div className="flex flex-col leading-tight">
            <span>Zartman</span>
            <span className="text-xs font-normal uppercase tracking-[0.35em] text-ink-muted">
              marketplace
            </span>
          </div>
        </Link>

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

        <div className="flex flex-wrap items-center justify-start gap-3 text-sm font-medium text-ink-soft md:justify-end">
          {RIGHT_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-full border border-transparent px-3 py-1.5 transition-colors hover:border-slate-800 hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/login"
            className="rounded-full px-3 py-1.5 text-ink-soft transition-colors hover:text-ink"
          >
            Log in
          </Link>
          <Link href="/quote" className={primaryCtaClasses}>
            Get quote
          </Link>
        </div>
      </div>
    </header>
  );
}
