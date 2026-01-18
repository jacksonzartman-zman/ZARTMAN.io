"use server";

import { redirect } from "next/navigation";
import { getFormString, serializeActionError } from "@/lib/forms";
import { requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { logSupplierInvitedOpsEvent } from "@/server/ops/events";
import { createDiscoveredProviderStub } from "@/server/providers";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";

const SUPPLIER_INVITE_ERROR =
  "We couldn’t capture that invite. Please try again.";
const SUPPLIER_NAME_REQUIRED = "Supplier name is required.";
const SUPPLIER_EMAIL_REQUIRED = "Enter a valid supplier email.";
const SUPPLIER_NAME_LENGTH = "Supplier name must be 200 characters or fewer.";
const SUPPLIER_NOTE_LENGTH = "Note must be 2000 characters or fewer.";

const MAX_NAME_LENGTH = 200;
const MAX_NOTE_LENGTH = 2000;

export async function inviteSupplierAction(formData: FormData) {
  try {
    const user = await requireUser({ redirectTo: "/customer/invite-supplier" });
    const customer = await getCustomerByUserId(user.id);

    if (!customer) {
      redirect(
        "/customer/invite-supplier?error=Complete%20your%20customer%20profile%20before%20inviting%20a%20supplier.",
      );
    }

    const supplierName = normalizeText(getFormString(formData, "supplierName"));
    if (!supplierName) {
      redirect(`/customer/invite-supplier?error=${encodeURIComponent(SUPPLIER_NAME_REQUIRED)}`);
    }
    if (supplierName.length > MAX_NAME_LENGTH) {
      redirect(`/customer/invite-supplier?error=${encodeURIComponent(SUPPLIER_NAME_LENGTH)}`);
    }

    const supplierEmail = normalizeEmailInput(getFormString(formData, "email"));
    if (!supplierEmail || !supplierEmail.includes("@")) {
      redirect(`/customer/invite-supplier?error=${encodeURIComponent(SUPPLIER_EMAIL_REQUIRED)}`);
    }

    const note = normalizeOptionalText(getFormString(formData, "note"));
    if (note && note.length > MAX_NOTE_LENGTH) {
      redirect(`/customer/invite-supplier?error=${encodeURIComponent(SUPPLIER_NOTE_LENGTH)}`);
    }

    let providerId: string | null = null;
    try {
      const providerResult = await createDiscoveredProviderStub({
        name: supplierName,
        email: supplierEmail,
        notes: note,
      });
      providerId = providerResult.providerId ?? null;
    } catch (error) {
      console.warn("[customer invite supplier] provider stub failed", {
        error: serializeActionError(error),
      });
    }

    await logSupplierInvitedOpsEvent({
      email: supplierEmail,
      supplierName,
      note,
      customerId: customer.id,
      customerEmail: customer.email ?? null,
      userId: user.id,
      providerId,
    });

    redirect("/customer/invite-supplier?submitted=1");
  } catch (error) {
    console.error("[customer invite supplier] action failed", {
      error: serializeActionError(error),
    });
    redirect(`/customer/invite-supplier?error=${encodeURIComponent(SUPPLIER_INVITE_ERROR)}`);
  }
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}
