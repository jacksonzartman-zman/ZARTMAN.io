"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabaseServer";
import { requireUser } from "@/server/auth";
import {
  loadSupplierByPrimaryEmail,
  loadSupplierByUserId,
} from "@/server/suppliers/profile";
import { serializeActionError } from "@/lib/forms";

export type SupplierNotificationSettingsFormState =
  | { ok: true; message: string }
  | { ok: false; error: string };

const SUCCESS_MESSAGE = "Notification preferences saved.";
const GENERIC_ERROR =
  "We couldn’t update your notification preferences. Please try again.";

export async function submitSupplierNotificationSettingsAction(
  _prevState: SupplierNotificationSettingsFormState,
  formData: FormData,
): Promise<SupplierNotificationSettingsFormState> {
  try {
    const user = await requireUser({ redirectTo: "/supplier/settings" });

    let supplier = await loadSupplierByUserId(user.id);
    if (!supplier && user.email) {
      supplier = await loadSupplierByPrimaryEmail(user.email);
    }

    if (!supplier) {
      return {
        ok: false,
        error: "Complete supplier onboarding before updating notifications.",
      };
    }

    const notifyQuoteMessages = Boolean(formData.get("notify_quote_messages"));
    const notifyQuoteWinner = Boolean(formData.get("notify_quote_winner"));

    const { error } = await supabaseServer
      .from("suppliers")
      .update({
        notify_quote_messages: notifyQuoteMessages,
        notify_quote_winner: notifyQuoteWinner,
      })
      .eq("id", supplier.id);

    if (error) {
      console.error("[settings notifications] supplier update failed", {
        supplierId: supplier.id,
        error: serializeActionError(error),
      });
      return { ok: false, error: GENERIC_ERROR };
    }

    console.log("[settings notifications] supplier prefs updated", {
      supplierId: supplier.id,
      notifyQuoteMessages,
      notifyQuoteWinner,
    });

    revalidatePath("/supplier/settings");

    return { ok: true, message: SUCCESS_MESSAGE };
  } catch (error) {
    console.error("[settings notifications] supplier update crashed", {
      error: serializeActionError(error),
    });
    return { ok: false, error: GENERIC_ERROR };
  }
}
