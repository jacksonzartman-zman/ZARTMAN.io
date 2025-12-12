"use server";

import { revalidatePath } from "next/cache";
import { CUSTOMER_NOTIFICATION_OPTIONS } from "@/constants/notificationPreferences";
import { serializeActionError } from "@/lib/forms";
import { requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { upsertNotificationPreference } from "@/server/notifications/preferences";

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

    const updates = CUSTOMER_NOTIFICATION_OPTIONS.map((option) => ({
      eventType: option.eventType,
      channel: option.channel,
      enabled: Boolean(formData.get(option.inputName)),
    }));

    const results = await Promise.all(
      updates.map((update) =>
        upsertNotificationPreference({
          userId: user.id,
          role: "customer",
          eventType: update.eventType,
          channel: update.channel,
          enabled: update.enabled,
        }),
      ),
    );

    if (results.some((ok) => !ok)) {
      console.error("[settings notifications] customer prefs write failed", {
        customerId: customer.id,
        updates,
      });
      return { ok: false, error: GENERIC_ERROR };
    }

    console.log("[settings notifications] customer prefs updated", {
      customerId: customer.id,
      updates,
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
