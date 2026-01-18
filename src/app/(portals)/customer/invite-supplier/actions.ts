"use server";

import { redirect } from "next/navigation";
import { getFormString, serializeActionError } from "@/lib/forms";
import { requireCustomerSessionOrRedirect } from "@/app/(portals)/customer/requireCustomerSessionOrRedirect";
import { getCustomerByUserId } from "@/server/customers";
import { logSupplierInvitedOpsEvent } from "@/server/ops/events";
import { createCustomerInviteProviderStub } from "@/server/providers";

const SUPPLIER_INVITE_ERROR =
  "We couldn’t capture that invite. Please try again.";
const SUPPLIER_NAME_REQUIRED = "Supplier name is required.";
const SUPPLIER_EMAIL_INVALID = "Enter a valid supplier email or leave it blank.";
const SUPPLIER_WEBSITE_INVALID = "Enter a valid supplier website or leave it blank.";
const SUPPLIER_NAME_LENGTH = "Supplier name must be 200 characters or fewer.";
const SUPPLIER_NOTE_LENGTH = "Note must be 2000 characters or fewer.";

const MAX_NAME_LENGTH = 200;
const MAX_NOTE_LENGTH = 2000;

export async function inviteSupplierAction(formData: FormData) {
  try {
    const user = await requireCustomerSessionOrRedirect("/customer/invite-supplier");
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

    const supplierEmailInput = normalizeText(getFormString(formData, "email"));
    const supplierEmail = normalizeEmail(supplierEmailInput);
    if (supplierEmailInput && !supplierEmail) {
      redirect(`/customer/invite-supplier?error=${encodeURIComponent(SUPPLIER_EMAIL_INVALID)}`);
    }

    const supplierWebsiteInput = getFormString(formData, "website");
    const { normalizedWebsite: supplierWebsite, error: websiteError } =
      normalizeWebsiteInput(supplierWebsiteInput);
    if (websiteError) {
      redirect(`/customer/invite-supplier?error=${encodeURIComponent(websiteError)}`);
    }

    const note = normalizeOptionalText(getFormString(formData, "note"));
    if (note && note.length > MAX_NOTE_LENGTH) {
      redirect(`/customer/invite-supplier?error=${encodeURIComponent(SUPPLIER_NOTE_LENGTH)}`);
    }

    const needsResearch = !supplierEmail && !supplierWebsite;

    let providerId: string | null = null;
    try {
      const providerResult = await createCustomerInviteProviderStub({
        name: supplierName,
        email: supplierEmail,
        website: supplierWebsite,
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
      website: supplierWebsite,
      supplierName,
      note,
      needsResearch,
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

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (!normalized.includes("@")) return null;
  if (/\s/.test(normalized)) return null;
  const parts = normalized.split("@");
  if (parts.length !== 2) return null;
  if (!parts[0] || !parts[1] || !parts[1].includes(".")) return null;
  return normalized;
}

function normalizeWebsiteInput(
  value: unknown,
): { normalizedWebsite: string | null; error: string | null } {
  if (typeof value !== "string") {
    return { normalizedWebsite: null, error: null };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { normalizedWebsite: null, error: null };
  }
  const hasScheme = /^https?:\/\//i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { normalizedWebsite: null, error: SUPPLIER_WEBSITE_INVALID };
    }
    return { normalizedWebsite: url.toString(), error: null };
  } catch {
    return { normalizedWebsite: null, error: SUPPLIER_WEBSITE_INVALID };
  }
}
