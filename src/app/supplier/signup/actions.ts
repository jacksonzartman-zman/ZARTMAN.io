"use server";

import { requestMagicLinkForEmail } from "@/app/auth/actions";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import {
  getOrCreateSupplierByEmail,
  upsertSupplierProfile,
  type SupplierCapabilityInput,
} from "@/server/suppliers";

export type SupplierSignupActionState = {
  success: boolean;
  error: string | null;
  fieldErrors?: Record<string, string>;
  submittedEmail?: string | null;
};

const GENERIC_ERROR =
  "We couldn’t create your supplier profile right now. Please try again.";

export async function createSupplierAndSendMagicLinkAction(
  _prev: SupplierSignupActionState,
  formData: FormData,
): Promise<SupplierSignupActionState> {
  const companyName = getText(formData, "company_name");
  const rawEmail = getText(formData, "work_email");
  const primaryProcess = getText(formData, "primary_process");
  const phone = getText(formData, "phone");
  const country = getText(formData, "country");
  const normalizedEmail = normalizeEmailInput(rawEmail);

  const fieldErrors: Record<string, string> = {};

  if (!companyName) {
    fieldErrors.company_name = "Enter your company name.";
  }
  if (!normalizedEmail) {
    fieldErrors.work_email = "Enter a valid work email.";
  }
  if (!primaryProcess) {
    fieldErrors.primary_process = "Enter your primary process.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      success: false,
      error: "Please fix the highlighted fields.",
      fieldErrors,
    };
  }

  try {
    await getOrCreateSupplierByEmail(normalizedEmail!, companyName ?? undefined);

    const profile = await upsertSupplierProfile({
      primaryEmail: normalizedEmail!,
      companyName: companyName ?? undefined,
      phone,
      country,
      capabilities: [buildCapabilityFromProcess(primaryProcess!)],
    });

    if (!profile?.supplier) {
      return {
        success: false,
        error: GENERIC_ERROR,
      };
    }

    const magicLinkResult = await requestMagicLinkForEmail({
      role: "supplier",
      email: normalizedEmail!,
      nextPath: "/supplier",
    });

    if (!magicLinkResult.success) {
      return {
        success: false,
        error: magicLinkResult.error ?? GENERIC_ERROR,
      };
    }

    return {
      success: true,
      error: null,
      submittedEmail: magicLinkResult.normalizedEmail ?? normalizedEmail!,
    };
  } catch (error) {
    console.error("createSupplierAndSendMagicLinkAction: unexpected error", {
      error,
      companyName,
      normalizedEmail,
    });
    return { success: false, error: GENERIC_ERROR };
  }
}

function buildCapabilityFromProcess(
  process: string,
): SupplierCapabilityInput {
  return {
    process,
    materials: [],
    certifications: [],
  };
}

function getText(formData: FormData, key: string): string | null {
  const raw = formData.get(key);
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
