"use server";

import { requestMagicLinkForEmail } from "@/app/auth/actions";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import {
  attachQuotesToCustomer,
  upsertCustomerByEmail,
} from "@/server/customers";

export type CustomerSignupActionState = {
  success: boolean;
  error: string | null;
  fieldErrors?: Record<string, string>;
  submittedEmail?: string | null;
};

const GENERIC_ERROR =
  "We couldn’t create your workspace just now. Please try again.";

export async function createCustomerAndSendMagicLinkAction(
  _prev: CustomerSignupActionState,
  formData: FormData,
): Promise<CustomerSignupActionState> {
  const firstName = getText(formData, "first_name");
  const lastName = getText(formData, "last_name");
  const companyName = getText(formData, "company_name");
  const rawEmail = getText(formData, "work_email");
  const roleTitle = getText(formData, "role_title");
  const phone = getText(formData, "phone");
  const normalizedEmail = normalizeEmailInput(rawEmail);

  const fieldErrors: Record<string, string> = {};

  if (!firstName) {
    fieldErrors.first_name = "Enter your first name.";
  }
  if (!lastName) {
    fieldErrors.last_name = "Enter your last name.";
  }
  if (!companyName) {
    fieldErrors.company_name = "Enter your company name.";
  }
  if (!normalizedEmail) {
    fieldErrors.work_email = "Enter a valid work email.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      success: false,
      error: "Please fix the highlighted fields.",
      fieldErrors,
    };
  }

  try {
    const profile = await upsertCustomerByEmail({
      email: normalizedEmail!,
      companyName: companyName!,
      phone,
    });

    if (!profile) {
      return { success: false, error: GENERIC_ERROR };
    }

    await attachQuotesToCustomer(profile.id, normalizedEmail!);

    const magicLinkResult = await requestMagicLinkForEmail({
      role: "customer",
      email: normalizedEmail!,
      nextPath: "/customer",
    });

    if (!magicLinkResult.ok) {
      return {
        success: false,
        error: magicLinkResult.error ?? GENERIC_ERROR,
      };
    }

    return {
      success: true,
      error: null,
      submittedEmail: normalizedEmail!,
    };
  } catch (error) {
    console.error("createCustomerAndSendMagicLinkAction: unexpected error", {
      error,
      companyName,
      roleTitle,
    });
    return { success: false, error: GENERIC_ERROR };
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
