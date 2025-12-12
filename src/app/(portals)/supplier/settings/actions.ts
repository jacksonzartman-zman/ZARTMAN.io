"use server";

import { revalidatePath } from "next/cache";
import { SUPPLIER_NOTIFICATION_OPTIONS } from "@/constants/notificationPreferences";
import { serializeActionError } from "@/lib/forms";
import { requireUser } from "@/server/auth";
import {
  loadSupplierByPrimaryEmail,
  loadSupplierByUserId,
} from "@/server/suppliers/profile";
import { upsertNotificationPreference } from "@/server/notifications/preferences";

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

    const updates = SUPPLIER_NOTIFICATION_OPTIONS.map((option) => ({
      eventType: option.eventType,
      channel: option.channel,
      enabled: Boolean(formData.get(option.inputName)),
    }));

    const results = await Promise.all(
      updates.map((update) =>
        upsertNotificationPreference({
          userId: user.id,
          role: "supplier",
          eventType: update.eventType,
          channel: update.channel,
          enabled: update.enabled,
        }),
      ),
    );

    if (results.some((ok) => !ok)) {
      console.error("[settings notifications] supplier prefs write failed", {
        supplierId: supplier.id,
        updates,
      });
      return { ok: false, error: GENERIC_ERROR };
    }

    console.log("[settings notifications] supplier prefs updated", {
      supplierId: supplier.id,
      updates,
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
