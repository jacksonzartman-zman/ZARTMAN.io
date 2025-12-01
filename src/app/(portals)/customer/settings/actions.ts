"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabaseServer";
import { requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { serializeActionError } from "@/lib/forms";

export type CustomerNotificationSettingsFormState =
  | { ok: true; message: string }
  | { ok: false; error: string };

const SUCCESS_MESSAGE = "Notification preferences saved.";
const GENERIC_ERROR =
  "We couldn’t update your notification preferences. Please try again.";

export async function submitCustomerNotificationSettingsAction(
  _prevState: CustomerNotificationSettingsFormState,
  formData: FormData,
): Promise<CustomerNotificationSettingsFormState> {
  try {
    const user = await requireUser({ redirectTo: "/customer/settings" });
    const customer = await getCustomerByUserId(user.id);

    if (!customer) {
      return {
        ok: false,
        error: "Complete your customer profile before updating notifications.",
      };
    }

    const notifyQuoteMessages = Boolean(formData.get("notify_quote_messages"));
    const notifyQuoteWinner = Boolean(formData.get("notify_quote_winner"));

    const { error } = await supabaseServer
      .from("customers")
      .update({
        notify_quote_messages: notifyQuoteMessages,
        notify_quote_winner: notifyQuoteWinner,
        updated_at: new Date().toISOString(),
      })
      .eq("id", customer.id);

    if (error) {
      console.error("[settings notifications] customer update failed", {
        customerId: customer.id,
        error: serializeActionError(error),
      });
      return { ok: false, error: GENERIC_ERROR };
    }

    console.log("[settings notifications] customer prefs updated", {
      customerId: customer.id,
      notifyQuoteMessages,
      notifyQuoteWinner,
    });

    revalidatePath("/customer/settings");

    return { ok: true, message: SUCCESS_MESSAGE };
  } catch (error) {
    console.error("[settings notifications] customer update crashed", {
      error: serializeActionError(error),
    });
    return { ok: false, error: GENERIC_ERROR };
  }
}
