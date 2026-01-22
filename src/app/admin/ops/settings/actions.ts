"use server";

import { revalidatePath } from "next/cache";
import { requireAdminUser } from "@/server/auth";
import { upsertOpsSlaSettings } from "@/server/ops/settings";

export type OpsSlaSettingsFormState = {
  ok: boolean;
  message: string;
  error?: string;
  fieldErrors?: {
    queuedMaxHours?: string;
    sentNoReplyMaxHours?: string;
    messageReplyMaxHours?: string;
  };
};

export async function saveOpsSlaSettingsAction(
  _prevState: OpsSlaSettingsFormState,
  formData: FormData,
): Promise<OpsSlaSettingsFormState> {
  await requireAdminUser();

  const queuedResult = parseHoursInput(formData.get("queuedMaxHours"));
  const sentResult = parseHoursInput(formData.get("sentNoReplyMaxHours"));
  const messageReplyResult = parseHoursInput(formData.get("messageReplyMaxHours"));
  const fieldErrors: OpsSlaSettingsFormState["fieldErrors"] = {};

  if (queuedResult.error) {
    fieldErrors.queuedMaxHours = queuedResult.error;
  }
  if (sentResult.error) {
    fieldErrors.sentNoReplyMaxHours = sentResult.error;
  }
  if (messageReplyResult.error) {
    fieldErrors.messageReplyMaxHours = messageReplyResult.error;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      message: "",
      error: "Please fix the highlighted fields.",
      fieldErrors,
    };
  }

  const result = await upsertOpsSlaSettings({
    queuedMaxHours: queuedResult.value ?? 0,
    sentNoReplyMaxHours: sentResult.value ?? 0,
    messageReplyMaxHours: messageReplyResult.value ?? undefined,
  });

  if (!result.ok) {
    return {
      ok: false,
      message: "",
      error: result.error,
    };
  }

  revalidatePath("/admin/ops/inbox");
  revalidatePath("/admin/ops/settings");

  return {
    ok: true,
    message: "SLA settings saved.",
  };
}

function parseHoursInput(raw: FormDataEntryValue | null): {
  value: number | null;
  error: string | null;
} {
  if (typeof raw !== "string") {
    return { value: null, error: "Enter a whole number of hours." };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { value: null, error: "Enter a value." };
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { value: null, error: "Enter a non-negative number." };
  }
  if (!Number.isInteger(parsed)) {
    return { value: null, error: "Use whole hours." };
  }
  return { value: parsed, error: null };
}
