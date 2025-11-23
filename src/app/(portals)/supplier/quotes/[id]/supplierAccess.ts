import { supabaseServer } from "@/lib/supabaseServer";
import type { QuoteWithUploadsRow } from "@/server/quotes/types";
import type {
  SupplierCapabilityRow,
  SupplierRow,
} from "@/server/suppliers";
import {
  normalizeEmailInput,
} from "@/app/(portals)/quotes/pageUtils";

export type SupplierAssignment = {
  supplier_email: string | null;
  supplier_name: string | null;
};

export async function loadSupplierAssignments(
  quoteId: string,
): Promise<SupplierAssignment[]> {
  try {
    const { data, error } = await supabaseServer
      .from("quote_suppliers")
      .select("supplier_email,supplier_name")
      .eq("quote_id", quoteId);

    if (error) {
      console.error("Supplier portal: failed to load assignments", error);
      return [];
    }

    return (data as SupplierAssignment[]) ?? [];
  } catch (error) {
    console.error("Supplier portal: unexpected assignment error", error);
    return [];
  }
}

type QuoteAssignmentSource = Pick<
  QuoteWithUploadsRow,
  "id" | "email" | "assigned_supplier_email" | "assigned_supplier_name"
>;

type SupplierAccessOptions = {
  supplier?: SupplierRow | null;
  verifiedProcessMatch?: boolean;
};

export function supplierHasAccess(
  supplierEmail: string | null,
  quote: QuoteAssignmentSource,
  assignments: SupplierAssignment[],
  options?: SupplierAccessOptions,
): boolean {
  const normalizedEmail = normalizeEmailInput(supplierEmail);
  if (!normalizedEmail) {
    console.error("Supplier access: missing or invalid identity email", {
      quoteId: quote.id,
      supplierEmail,
    });
    return false;
  }

  const normalizedAssigned = normalizeEmailInput(quote.assigned_supplier_email);
  if (normalizedAssigned && normalizedAssigned === normalizedEmail) {
    return true;
  }

  const hasExplicitAssignment = assignments.some(
    (assignment) =>
      normalizeEmailInput(assignment.supplier_email) === normalizedEmail,
  );
  if (hasExplicitAssignment) {
    return true;
  }

  if (
    options?.supplier &&
    options.supplier.verified &&
    options.verifiedProcessMatch &&
    normalizeEmailInput(options.supplier.primary_email) === normalizedEmail
  ) {
    console.warn("Supplier access: allowing via verified capability match", {
      quoteId: quote.id,
      supplierEmail: normalizedEmail,
    });
    return true;
  }

  // TEMP: Dev/demo fallback so supplier portal can be exercised before quote_suppliers is populated.
  const normalizedQuoteEmail = normalizeEmailInput(quote.email);
  if (normalizedQuoteEmail && normalizedQuoteEmail === normalizedEmail) {
    console.warn("Supplier access: using dev fallback via quote.email match", {
      quoteId: quote.id,
      supplierEmail: normalizedEmail,
      quoteEmail: quote.email,
    });
    return true;
  }

  console.error("Supplier access denied", {
    quoteId: quote.id,
    supplierEmail: normalizedEmail,
    quoteEmail: quote.email,
    assignmentCount: assignments.length,
  });
  return false;
}

export function getSupplierDisplayName(
  supplierEmail: string,
  quote: QuoteAssignmentSource,
  assignments: SupplierAssignment[],
): string {
  const normalizedEmail = normalizeEmailInput(supplierEmail);
  const assignmentMatch = assignments.find(
    (assignment) =>
      normalizeEmailInput(assignment.supplier_email) === normalizedEmail,
  );

  if (assignmentMatch?.supplier_name) {
    return assignmentMatch.supplier_name;
  }

  if (quote.assigned_supplier_name) {
    return quote.assigned_supplier_name;
  }

  return normalizedEmail ?? "Supplier";
}

export function matchesSupplierProcess(
  capabilities: SupplierCapabilityRow[],
  processHint?: string | null,
): boolean {
  if (!processHint || capabilities.length === 0) {
    return false;
  }

  const normalizedProcess = processHint.trim().toLowerCase();
  if (!normalizedProcess) {
    return false;
  }

  return capabilities.some((capability) => {
    if (!capability?.process) {
      return false;
    }
    const capabilityProcess = capability.process.trim().toLowerCase();
    if (!capabilityProcess) {
      return false;
    }
    return (
      capabilityProcess === normalizedProcess ||
      normalizedProcess.includes(capabilityProcess) ||
      capabilityProcess.includes(normalizedProcess)
    );
  });
}
