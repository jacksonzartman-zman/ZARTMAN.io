"use server";

import { revalidatePath } from "next/cache";
import { getFormString, serializeActionError } from "@/lib/forms";
import { requireAdminUser } from "@/server/auth";
import { schemaGate } from "@/server/db/schemaContract";
import { logOpsEvent } from "@/server/ops/events";

const WARN_PREFIX = "[admin search alerts]";

export async function markSearchAlertNotifiedAction(formData: FormData): Promise<void> {
  const quoteId = normalizeId(getFormString(formData, "quoteId"));
  const label = normalizeOptionalText(getFormString(formData, "label"));
  if (!quoteId) return;

  try {
    await requireAdminUser();

    const opsEventsSupported = await schemaGate({
      enabled: true,
      relation: "ops_events",
      requiredColumns: ["quote_id", "event_type", "payload", "created_at"],
      warnPrefix: WARN_PREFIX,
      warnKey: "admin_search_alerts:mark_notified",
    });
    if (!opsEventsSupported) {
      return;
    }

    await logOpsEvent({
      quoteId,
      eventType: "search_alert_notified",
      payload: {
        source: "admin_search_alerts",
        label: label ?? undefined,
      },
    });

    revalidatePath("/admin/search-alerts");
    revalidatePath("/admin/alerts");
  } catch (error) {
    console.error("[admin search alerts] mark notified crashed", {
      quoteId,
      error: serializeActionError(error),
    });
  }
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
