import {
  SHOW_LEGACY_QUOTE_ENTRYPOINTS,
  SHOW_SUPPLIER_DIRECTORY_PUBLIC,
} from "@/lib/ui/deprecation";

export type PublicNavLink = {
  label: string;
  href: string;
  description?: string;
};

export type PublicNavColumn = {
  title: string;
  links: PublicNavLink[];
};

export type PublicNavConfig = {
  headerLinks: PublicNavLink[];
  primaryCta: PublicNavLink;
  authLink: PublicNavLink;
  footerColumns: PublicNavColumn[];
};

const CUSTOMER_SEARCH_HREF = "/customer/search";
const LEGACY_QUOTE_HREF = "/quote";
const HOW_IT_WORKS_HREF = "/capabilities";
const SUPPLIER_DIRECTORY_HREF = "/suppliers";
const SUPPLIER_JOIN_HREF = "/suppliers/join";

const COMPANY_LINKS: PublicNavLink[] = [
  { label: "About", href: "/about" },
  { label: "FAQ", href: "/faq" },
  { label: "Contact", href: "/contact" },
  { label: "Privacy", href: "/privacy" },
];

export function getPublicNavConfig(): PublicNavConfig {
  const entrypointHref = SHOW_LEGACY_QUOTE_ENTRYPOINTS
    ? LEGACY_QUOTE_HREF
    : CUSTOMER_SEARCH_HREF;

  const primaryCta: PublicNavLink = {
    label: "Search suppliers",
    href: entrypointHref,
  };

  const howItWorksLink: PublicNavLink = {
    label: "How it works",
    href: HOW_IT_WORKS_HREF,
  };

  const supplierDirectoryLink: PublicNavLink = {
    label: "Suppliers",
    href: SUPPLIER_DIRECTORY_HREF,
  };

  const supplierJoinLink: PublicNavLink = {
    label: "Join as Supplier",
    href: SUPPLIER_JOIN_HREF,
  };

  const headerLinks: PublicNavLink[] = [
    howItWorksLink,
    ...(SHOW_SUPPLIER_DIRECTORY_PUBLIC ? [supplierDirectoryLink] : []),
  ];

  const footerMarketplaceLinks: PublicNavLink[] = [primaryCta, howItWorksLink];
  const footerSupplierLinks: PublicNavLink[] = SHOW_SUPPLIER_DIRECTORY_PUBLIC
    ? [supplierDirectoryLink, supplierJoinLink]
    : [supplierJoinLink];

  return {
    headerLinks,
    primaryCta,
    authLink: { label: "Sign in", href: "/login" },
    footerColumns: [
      { title: "Marketplace", links: footerMarketplaceLinks },
      { title: "Suppliers", links: footerSupplierLinks },
      { title: "Company", links: COMPANY_LINKS },
    ],
  };
}
