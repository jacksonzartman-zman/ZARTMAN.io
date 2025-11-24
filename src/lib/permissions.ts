import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";

type QuoteLike = {
  id?: string;
  email?: string | null;
  customer_email?: string | null;
  customerEmails?: string[];
  allowedCustomerEmails?: string[];
  customerDomain?: string | null;
  allowedCustomerDomains?: string[];
  orgDomain?: string | null;
  assigned_supplier_email?: string | null;
  assignedSupplierEmail?: string | null;
  assignments?: Array<{ supplier_email?: string | null; email?: string | null }>;
  supplierAssignments?: Array<{ supplier_email?: string | null; email?: string | null }>;
  allowedSupplierEmails?: string[];
  supplierContext?: {
    verifiedAccess?: boolean;
    verifiedEmails?: string[];
  };
  status?: string | null;
  accessGranted?: boolean;
  allowBids?: boolean;
  bidLocked?: boolean;
  existingBidStatus?: string | null;
};

export const OPEN_BID_STATUSES = [
  "submitted",
  "in_review",
  "quoted",
] as const;

const BID_OPEN_STATUS_SET: Set<string> = new Set(OPEN_BID_STATUSES);

export function canUserViewQuote(
  userRole: "customer" | "supplier",
  email: string,
  quote: QuoteLike | null | undefined,
): boolean {
  const normalizedEmail = normalizeEmailInput(email);
  if (!normalizedEmail || !quote) {
    return false;
  }

  if (userRole === "customer") {
    return evaluateCustomerAccess(normalizedEmail, quote);
  }

  if (userRole === "supplier") {
    return evaluateSupplierAccess(normalizedEmail, quote);
  }

  return false;
}

export function canUserBid(
  userRole: string,
  quote: QuoteLike | null | undefined,
): boolean {
  if (userRole !== "supplier" || !quote) {
    return false;
  }

  if (quote.accessGranted === false) {
    return false;
  }

  if (quote.allowBids === false) {
    return false;
  }

  if (quote.bidLocked === true) {
    return false;
  }

  const normalizedStatus = normalizeStatus(quote.status);
  if (normalizedStatus && !BID_OPEN_STATUS_SET.has(normalizedStatus)) {
    return false;
  }

  const existingBidStatus = normalizeStatus(quote.existingBidStatus);
  if (existingBidStatus === "accepted") {
    return false;
  }

  return true;
}

function evaluateCustomerAccess(email: string, quote: QuoteLike): boolean {
  const allowedEmails = collectEmails([
    quote.email,
    quote.customer_email,
    ...(quote.customerEmails ?? []),
    ...(quote.allowedCustomerEmails ?? []),
  ]);

  if (allowedEmails.has(email)) {
    return true;
  }

  const domain = email.split("@")[1];
  if (!domain) {
    return false;
  }

  const allowedDomains = collectDomains([
    quote.customerDomain,
    quote.orgDomain,
    ...(quote.allowedCustomerDomains ?? []),
  ]);

  return allowedDomains.has(domain);
}

function evaluateSupplierAccess(email: string, quote: QuoteLike): boolean {
  const allowedEmails = collectEmails([
    quote.assigned_supplier_email,
    quote.assignedSupplierEmail,
    ...(quote.allowedSupplierEmails ?? []),
    ...extractAssignmentEmails(quote.assignments),
    ...extractAssignmentEmails(quote.supplierAssignments),
  ]);

  if (allowedEmails.has(email)) {
    return true;
  }

  const verifiedEmails = collectEmails(
    quote.supplierContext?.verifiedEmails ?? [],
  );
  if (quote.supplierContext?.verifiedAccess && verifiedEmails.has(email)) {
    return true;
  }

  const fallbackQuoteEmail = normalizeEmailInput(quote.email ?? null);
  if (fallbackQuoteEmail && fallbackQuoteEmail === email) {
    return true;
  }

  return false;
}

function collectEmails(values: Array<string | null | undefined>): Set<string> {
  const emails = new Set<string>();
  values.forEach((value) => {
    const normalized = normalizeEmailInput(value ?? null);
    if (normalized) {
      emails.add(normalized);
    }
  });
  return emails;
}

function extractAssignmentEmails(
  assignments?: Array<{ supplier_email?: string | null; email?: string | null }>,
): Array<string | null | undefined> {
  if (!assignments || assignments.length === 0) {
    return [];
  }
  return assignments.map(
    (assignment) => assignment?.supplier_email ?? assignment?.email ?? null,
  );
}

function collectDomains(values: Array<string | null | undefined>): Set<string> {
  const domains = new Set<string>();
  values.forEach((value) => {
    if (!value) {
      return;
    }
    const normalized = value.trim().toLowerCase().replace(/^@/, "");
    if (normalized.includes(".")) {
      domains.add(normalized);
    }
  });
  return domains;
}

function normalizeStatus(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return value.trim().toLowerCase();
}
