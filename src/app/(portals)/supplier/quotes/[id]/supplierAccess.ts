import { supabaseServer } from "@/lib/supabaseServer";
import type { QuoteWithUploadsRow } from "@/server/quotes/types";
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
  "assigned_supplier_email" | "assigned_supplier_name"
>;

export function supplierHasAccess(
  supplierEmail: string,
  quote: QuoteAssignmentSource,
  assignments: SupplierAssignment[],
): boolean {
  const normalizedEmail = normalizeEmailInput(supplierEmail);
  if (!normalizedEmail) {
    return false;
  }

  const normalizedAssigned = normalizeEmailInput(quote.assigned_supplier_email);
  if (normalizedAssigned && normalizedAssigned === normalizedEmail) {
    return true;
  }

  return assignments.some(
    (assignment) =>
      normalizeEmailInput(assignment.supplier_email) === normalizedEmail,
  );
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
