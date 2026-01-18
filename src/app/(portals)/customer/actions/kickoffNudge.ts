"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabaseServer";
import { requireCustomerSessionOrRedirect } from "@/app/(portals)/customer/requireCustomerSessionOrRedirect";
import { getCustomerByUserId } from "@/server/customers";
import { serializeActionError } from "@/lib/forms";
import { nudgeSupplierKickoffAsCustomer } from "@/server/quotes/kickoffNudge";

export type CustomerKickoffNudgeActionResult =
  | { ok: true }
  | { ok: false; reason: "recent_nudge" | "access_denied" | "invalid_input" | "unavailable" };

type CustomerOwnedAwardedQuoteRow = {
  id: string;
  customer_id: string | null;
  awarded_supplier_id: string | null;
};

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function nudgeSupplierKickoffAction(args: {
  quoteId: string;
  supplierId: string;
}): Promise<CustomerKickoffNudgeActionResult> {
  const quoteId = normalizeId(args.quoteId);
  const supplierId = normalizeId(args.supplierId);
  if (!quoteId || !supplierId) {
    return { ok: false, reason: "invalid_input" };
  }

  try {
    const user = await requireCustomerSessionOrRedirect(`/customer/quotes/${quoteId}`);
    const customer = await getCustomerByUserId(user.id);
    if (!customer?.id) {
      return { ok: false, reason: "access_denied" };
    }

    const { data: quoteRow, error: quoteError } = await supabaseServer
      .from("quotes")
      .select("id,customer_id,awarded_supplier_id")
      .eq("id", quoteId)
      .maybeSingle<CustomerOwnedAwardedQuoteRow>();

    if (quoteError) {
      console.error("[customer kickoff nudge] quote lookup failed", {
        quoteId,
        supplierId,
        customerId: customer.id,
        error: serializeActionError(quoteError),
      });
      return { ok: false, reason: "unavailable" };
    }

    const quoteCustomerId = normalizeId(quoteRow?.customer_id);
    if (!quoteRow?.id || !quoteCustomerId || quoteCustomerId !== customer.id) {
      return { ok: false, reason: "access_denied" };
    }

    const awardedSupplierId = normalizeId(quoteRow.awarded_supplier_id);
    if (!awardedSupplierId || awardedSupplierId !== supplierId) {
      return { ok: false, reason: "access_denied" };
    }

    const result = await nudgeSupplierKickoffAsCustomer({
      quoteId,
      supplierId,
      actorUserId: user.id,
    });

    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason === "recent_nudge" ? "recent_nudge" : "unavailable",
      };
    }

    // Customer won't see the event, but admin + supplier pages should refresh.
    revalidatePath(`/admin/quotes/${quoteId}`);
    revalidatePath(`/supplier/quotes/${quoteId}`);
    revalidatePath(`/customer/quotes/${quoteId}`);
    revalidatePath("/customer/projects");

    return { ok: true };
  } catch (error) {
    console.error("[customer kickoff nudge] crashed", {
      quoteId,
      supplierId,
      error: serializeActionError(error),
    });
    return { ok: false, reason: "unavailable" };
  }
}

