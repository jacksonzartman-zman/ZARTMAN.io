import Link from "next/link";

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
        href: "/quote",
        description:
          "Submit your first RFQ and we’ll spin up your workspace behind the scenes.",
      },
    ],
  },
  {
    title: "Suppliers",
    links: [
      { label: "Supplier portal", href: "/supplier" },
      {
        label: "Become a supplier",
        href: "/supplier",
        description: "Use the magic-link portal to finish onboarding and unlock matches.",
      },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Contact", href: "/contact" },
      { label: "Privacy", href: "/privacy" },
    ],
  },
];

export default function SiteFooter() {
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
