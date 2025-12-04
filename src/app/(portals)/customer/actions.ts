"use server";

import { revalidatePath } from "next/cache";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import { requireUser } from "@/server/auth";
import {
  attachQuotesToCustomer,
  upsertCustomerProfileForUser,
} from "@/server/customers";

export type CompleteCustomerProfileActionState = {
  ok: boolean;
  error: string | null;
};

const GENERIC_ERROR =
  "We couldn’t save your profile. Please try again in a few seconds.";

export async function completeCustomerProfileAction(
  _prev: CompleteCustomerProfileActionState,
  formData: FormData,
): Promise<CompleteCustomerProfileActionState> {
  try {
    const user = await requireUser({ redirectTo: "/customer" });
    const companyName = getText(formData, "company_name");
    const phone = getText(formData, "phone");
    const website = getText(formData, "website");

    if (!companyName) {
      return { ok: false, error: "Enter your company name to continue." };
    }

    const normalizedEmail = normalizeEmailInput(user.email ?? null);
    if (!normalizedEmail) {
      console.error("completeCustomerProfileAction: session missing email", {
        userId: user.id,
      });
      return {
        ok: false,
        error: "We couldn’t confirm your email. Refresh or sign in again.",
      };
    }

    const payload = {
      companyName,
      phone,
      website,
    };

    console.log("[customer profile] save requested", {
      userId: user.id,
      email: normalizedEmail,
      payload,
    });

    const profileResult = await upsertCustomerProfileForUser({
      userId: user.id,
      email: normalizedEmail,
      ...payload,
    });

    console.log("[customer profile] save result", {
      userId: user.id,
      email: normalizedEmail,
      ok: profileResult.ok,
      operation: profileResult.ok ? profileResult.operation : undefined,
      error: profileResult.ok ? null : profileResult.error,
    });

    if (!profileResult.ok) {
      return {
        ok: false,
        error: profileResult.error ?? GENERIC_ERROR,
      };
    }

    await attachQuotesToCustomer(
      profileResult.customer.id,
      normalizedEmail,
    );
    revalidatePath("/customer");
    return { ok: true, error: null };
  } catch (error) {
    console.error("completeCustomerProfileAction: unexpected error", error);
    const message =
      error instanceof Error && error.message
        ? error.message
        : GENERIC_ERROR;
    return { ok: false, error: message };
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
