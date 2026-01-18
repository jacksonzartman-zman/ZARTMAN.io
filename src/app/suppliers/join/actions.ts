"use server";

import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import { logSupplierJoinOpsEvent } from "@/server/ops/events";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const GENERIC_ERROR = "We couldn't capture your email right now. Please try again.";

export type SupplierJoinFieldErrors = Partial<Record<"work_email", string>>;

export type SupplierJoinActionState = {
  success: boolean;
  error: string | null;
  fieldErrors?: SupplierJoinFieldErrors;
  submittedEmail?: string | null;
};

export async function submitSupplierJoinRequest(
  _prev: SupplierJoinActionState,
  formData: FormData,
): Promise<SupplierJoinActionState> {
  const rawEmail = getText(formData, "work_email");
  const normalizedEmail = normalizeEmailInput(rawEmail);
  const supplierSlug = getText(formData, "supplier_slug");
  const source = getText(formData, "source");

  const fieldErrors: SupplierJoinFieldErrors = {};

  if (!normalizedEmail || !EMAIL_REGEX.test(normalizedEmail)) {
    fieldErrors.work_email = "Enter a valid work email.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      success: false,
      error: "Please fix the highlighted fields and try again.",
      fieldErrors,
    };
  }

  try {
    await logSupplierJoinOpsEvent({
      email: normalizedEmail!,
      supplierSlug,
      source,
    });

    return {
      success: true,
      error: null,
      submittedEmail: normalizedEmail,
    };
  } catch (error) {
    console.error("submitSupplierJoinRequest: unexpected error", {
      error,
      normalizedEmail,
      supplierSlug,
      source,
    });
    return {
      success: false,
      error: GENERIC_ERROR,
    };
  }
}

function getText(formData: FormData, key: string): string | null {
  const raw = formData.get(key);
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
