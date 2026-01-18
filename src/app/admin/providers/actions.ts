"use server";

import { revalidatePath } from "next/cache";
import { getFormString, serializeActionError } from "@/lib/forms";
import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";
import { serializeSupabaseError } from "@/server/admin/logging";
import { logProviderContactedOpsEvent } from "@/server/ops/events";
import { resolveProviderEmailColumn } from "@/server/providers";
import { hasColumns, schemaGate } from "@/server/db/schemaContract";

const PROVIDER_ACTION_ERROR = "We couldn't update this provider right now.";

export async function verifyProviderAction(formData: FormData): Promise<void> {
  const providerId = normalizeId(getFormString(formData, "providerId"));
  if (!providerId) return;

  try {
    await requireAdminUser();

    const supported = await schemaGate({
      enabled: true,
      relation: "providers",
      requiredColumns: ["id", "verification_status", "verified_at"],
      warnPrefix: "[admin providers]",
      warnKey: "admin_providers_verify",
    });
    if (!supported) {
      return;
    }

    const { error } = await supabaseServer
      .from("providers")
      .update({
        verification_status: "verified",
        verified_at: new Date().toISOString(),
      })
      .eq("id", providerId);

    if (error) {
      console.error("[admin providers] verify failed", {
        providerId,
        error: serializeSupabaseError(error),
      });
      return;
    }

    revalidatePath("/admin/providers");
  } catch (error) {
    console.error("[admin providers] verify crashed", {
      providerId,
      error: serializeActionError(error),
    });
  }
}

export async function toggleProviderActiveAction(formData: FormData): Promise<void> {
  const providerId = normalizeId(getFormString(formData, "providerId"));
  const nextActiveRaw = getFormString(formData, "nextActive");
  const nextActive =
    nextActiveRaw === "true" ? true : nextActiveRaw === "false" ? false : null;
  if (!providerId || nextActive === null) return;

  try {
    await requireAdminUser();

    const supported = await schemaGate({
      enabled: true,
      relation: "providers",
      requiredColumns: ["id", "is_active"],
      warnPrefix: "[admin providers]",
      warnKey: "admin_providers_toggle_active",
    });
    if (!supported) {
      return;
    }

    const { error } = await supabaseServer
      .from("providers")
      .update({ is_active: nextActive })
      .eq("id", providerId);

    if (error) {
      console.error("[admin providers] toggle active failed", {
        providerId,
        error: serializeSupabaseError(error),
      });
      return;
    }

    revalidatePath("/admin/providers");
  } catch (error) {
    console.error("[admin providers] toggle active crashed", {
      providerId,
      error: serializeActionError(error),
    });
  }
}

export async function updateProviderContactAction(formData: FormData): Promise<void> {
  const providerId = normalizeId(getFormString(formData, "providerId"));
  if (!providerId) return;

  const websiteInput = normalizeText(getFormString(formData, "website"));
  const emailInput = normalizeText(getFormString(formData, "email"));

  try {
    await requireAdminUser();

    const emailColumn = await resolveProviderEmailColumn();
    const updates: Record<string, string | null> = {};
    if (typeof websiteInput === "string") {
      updates.website = websiteInput || null;
    }
    if (emailColumn) {
      updates[emailColumn] = emailInput || null;
    }

    if (Object.keys(updates).length === 0) {
      return;
    }

    const requiredColumns = ["id", "website", ...(emailColumn ? [emailColumn] : [])];
    const supported = await schemaGate({
      enabled: true,
      relation: "providers",
      requiredColumns,
      warnPrefix: "[admin providers]",
      warnKey: "admin_providers_update_contact",
    });
    if (!supported) {
      return;
    }

    const { error } = await supabaseServer
      .from("providers")
      .update(updates)
      .eq("id", providerId);

    if (error) {
      console.error("[admin providers] update contact failed", {
        providerId,
        error: serializeSupabaseError(error),
      });
      return;
    }

    revalidatePath("/admin/providers");
  } catch (error) {
    console.error("[admin providers] update contact crashed", {
      providerId,
      error: serializeActionError(error) ?? PROVIDER_ACTION_ERROR,
    });
  }
}

export async function markProviderContactedAction(formData: FormData): Promise<void> {
  const providerId = normalizeId(getFormString(formData, "providerId"));
  if (!providerId) return;

  try {
    await requireAdminUser();

    const [supportsContactedAt, emailColumn] = await Promise.all([
      hasColumns("providers", ["contacted_at"]),
      resolveProviderEmailColumn(),
    ]);

    let providerName: string | null = null;
    let providerEmail: string | null = null;

    try {
      const selectColumns = ["id", "name", ...(emailColumn ? [emailColumn] : [])].join(",");
      const { data, error } = await supabaseServer
        .from("providers")
        .select(selectColumns)
        .eq("id", providerId)
        .maybeSingle<Record<string, string | null>>();

      if (!error && data) {
        providerName = normalizeText(data.name);
        if (emailColumn) {
          providerEmail = normalizeText(data[emailColumn]) || null;
        }
      }
    } catch (error) {
      console.warn("[admin providers] provider lookup for contact event failed", {
        providerId,
        error: serializeActionError(error),
      });
    }

    if (supportsContactedAt) {
      const supported = await schemaGate({
        enabled: true,
        relation: "providers",
        requiredColumns: ["id", "contacted_at"],
        warnPrefix: "[admin providers]",
        warnKey: "admin_providers_mark_contacted",
      });
      if (supported) {
        const { error } = await supabaseServer
          .from("providers")
          .update({ contacted_at: new Date().toISOString() })
          .eq("id", providerId);

        if (error) {
          console.error("[admin providers] mark contacted failed", {
            providerId,
            error: serializeSupabaseError(error),
          });
        }
      }
    }

    await logProviderContactedOpsEvent({
      providerId,
      providerName,
      providerEmail,
    });

    revalidatePath("/admin/providers");
  } catch (error) {
    console.error("[admin providers] mark contacted crashed", {
      providerId,
      error: serializeActionError(error) ?? PROVIDER_ACTION_ERROR,
    });
  }
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
