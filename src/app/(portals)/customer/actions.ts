"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth";
import {
  attachQuotesToCustomer,
  upsertCustomerProfileForUser,
} from "@/server/customers";

export type CompleteCustomerProfileActionState = {
  error: string | null;
};

const GENERIC_ERROR =
  "We couldn’t save your profile. Please try again in a few seconds.";

export async function completeCustomerProfileAction(
  _prev: CompleteCustomerProfileActionState,
  formData: FormData,
): Promise<CompleteCustomerProfileActionState> {
  try {
    const session = await requireSession({ redirectTo: "/customer" });
    const companyName = getText(formData, "company_name");
    const phone = getText(formData, "phone");
    const website = getText(formData, "website");

    if (!companyName) {
      return { error: "Enter your company name to continue." };
    }

    if (!session.user.email) {
      console.error("completeCustomerProfileAction: session missing email", {
        userId: session.user.id,
      });
      return { error: GENERIC_ERROR };
    }

    const profile = await upsertCustomerProfileForUser({
      userId: session.user.id,
      email: session.user.email,
      companyName,
      phone,
      website,
    });

    if (!profile) {
      return { error: GENERIC_ERROR };
    }

    await attachQuotesToCustomer(profile.id, session.user.email);
    revalidatePath("/customer");
    redirect("/customer");
  } catch (error) {
    console.error("completeCustomerProfileAction: unexpected error", error);
    return { error: GENERIC_ERROR };
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
