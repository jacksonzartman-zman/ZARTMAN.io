"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type NavItem = { label: string; href: string };

const NAV: NavItem[] = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Suppliers", href: "/#suppliers" },
];

export default function SiteHeader() {
  const [open, setOpen] = useState(false);

  // Close the menu on resize up to desktop.
  useEffect(() => {
    function onResize() {
      if (window.innerWidth >= 768) setOpen(false);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-page/75 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-page items-center gap-3 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-md px-1 py-1 text-ink hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            aria-label="Home"
          >
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/10 text-sm font-semibold tracking-tight">
              Z
            </span>
            <span className="truncate text-sm font-semibold tracking-tight">
              <span className="text-ink/70">Zartman</span>
              <span className="text-ink/50">.</span>
              <span className="text-ink/70">io</span>{" "}
              <span className="text-ink/90">Marketplace</span>
            </span>
          </Link>
        </div>

        <nav className="hidden flex-1 items-center justify-center gap-6 md:flex" aria-label="Primary">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm font-medium text-ink/75 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 rounded-md px-2 py-1"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Link
            href="/#suppliers"
            className="inline-flex h-9 items-center justify-center rounded-pill bg-white px-4 text-sm font-semibold text-black shadow-sm hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            Search suppliers
          </Link>
          <Link
            href="/auth"
            className="inline-flex h-9 items-center justify-center rounded-pill px-4 text-sm font-semibold text-ink/80 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            Sign in
          </Link>
        </div>

        <button
          type="button"
          className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink/80 hover:bg-white/10 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="sr-only">Menu</span>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            {open ? (
              <path
                d="M5 5L15 15M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            ) : (
              <path
                d="M3.5 6H16.5M3.5 10H16.5M3.5 14H16.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            )}
          </svg>
        </button>
      </div>

      {open ? (
        <div id="mobile-nav" className="border-t border-white/5 bg-page/90 backdrop-blur md:hidden">
          <div className="mx-auto grid max-w-page gap-2 px-4 py-3">
            <nav className="grid gap-1" aria-label="Mobile primary">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-ink/80 hover:bg-white/10 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="grid gap-2 pt-2">
              <Link
                href="/#suppliers"
                onClick={() => setOpen(false)}
                className="inline-flex h-10 items-center justify-center rounded-pill bg-white px-4 text-sm font-semibold text-black shadow-sm hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
              >
                Search suppliers
              </Link>
              <Link
                href="/auth"
                onClick={() => setOpen(false)}
                className="inline-flex h-10 items-center justify-center rounded-pill border border-white/10 px-4 text-sm font-semibold text-ink/85 hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}

