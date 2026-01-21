"use server";

import { revalidatePath } from "next/cache";
import { getFormString, serializeActionError } from "@/lib/forms";
import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";
import { serializeSupabaseError } from "@/server/admin/logging";
import {
  logProviderContactedOpsEvent,
  logProviderDirectoryVisibilityEvent,
  logProviderStatusOpsEvent,
} from "@/server/ops/events";
import { resolveProviderEmailColumn } from "@/server/providers";
import { hasColumns, schemaGate } from "@/server/db/schemaContract";

const PROVIDER_ACTION_ERROR = "We couldn't update this provider right now.";
const BULK_PROVIDERS_INPUT_ERROR = "Select at least one provider.";
const BULK_PROVIDERS_GENERIC_ERROR = "We couldn't update these providers right now.";
const BULK_DIRECTORY_VISIBILITY_ERROR = "Directory visibility isn't available yet.";

export type BulkProviderActionResult =
  | { ok: true; message: string; updatedCount: number; skippedCount: number }
  | { ok: false; error: string };

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

    const verifiedAt = new Date().toISOString();
    const { error } = await supabaseServer
      .from("providers")
      .update({
        verification_status: "verified",
        verified_at: verifiedAt,
      })
      .eq("id", providerId);

    if (error) {
      console.error("[admin providers] verify failed", {
        providerId,
        error: serializeSupabaseError(error),
      });
      return;
    }

    await logProviderStatusOpsEvent({
      providerId,
      eventType: "provider_verified",
      snapshot: {
        verification_status: "verified",
        verified_at: verifiedAt,
      },
    });

    revalidatePath("/admin/providers");
    revalidatePath("/admin/providers/pipeline");
  } catch (error) {
    console.error("[admin providers] verify crashed", {
      providerId,
      error: serializeActionError(error),
    });
  }
}

export async function unverifyProviderAction(formData: FormData): Promise<void> {
  const providerId = normalizeId(getFormString(formData, "providerId"));
  if (!providerId) return;

  try {
    await requireAdminUser();

    const supported = await schemaGate({
      enabled: true,
      relation: "providers",
      requiredColumns: ["id", "verification_status", "verified_at"],
      warnPrefix: "[admin providers]",
      warnKey: "admin_providers_unverify",
    });
    if (!supported) {
      return;
    }

    const { error } = await supabaseServer
      .from("providers")
      .update({
        verification_status: "unverified",
        verified_at: null,
      })
      .eq("id", providerId);

    if (error) {
      console.error("[admin providers] unverify failed", {
        providerId,
        error: serializeSupabaseError(error),
      });
      return;
    }

    await logProviderStatusOpsEvent({
      providerId,
      eventType: "provider_unverified",
      snapshot: {
        verification_status: "unverified",
        verified_at: null,
      },
    });

    revalidatePath("/admin/providers");
    revalidatePath("/admin/providers/pipeline");
  } catch (error) {
    console.error("[admin providers] unverify crashed", {
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

    await logProviderStatusOpsEvent({
      providerId,
      eventType: nextActive ? "provider_activated" : "provider_deactivated",
      snapshot: {
        is_active: nextActive,
      },
    });

    revalidatePath("/admin/providers");
    revalidatePath("/admin/providers/pipeline");
  } catch (error) {
    console.error("[admin providers] toggle active crashed", {
      providerId,
      error: serializeActionError(error),
    });
  }
}

export async function toggleProviderDirectoryVisibilityAction(formData: FormData): Promise<void> {
  const providerId = normalizeId(getFormString(formData, "providerId"));
  const nextShowRaw = getFormString(formData, "nextShowInDirectory");
  const nextShow =
    nextShowRaw === "true" ? true : nextShowRaw === "false" ? false : null;
  if (!providerId || nextShow === null) return;

  try {
    await requireAdminUser();

    const supported = await schemaGate({
      enabled: true,
      relation: "providers",
      requiredColumns: ["id", "show_in_directory"],
      warnPrefix: "[admin providers]",
      warnKey: "admin_providers_toggle_directory",
    });
    if (!supported) {
      return;
    }

    const { error } = await supabaseServer
      .from("providers")
      .update({ show_in_directory: nextShow })
      .eq("id", providerId);

    if (error) {
      console.error("[admin providers] toggle directory visibility failed", {
        providerId,
        error: serializeSupabaseError(error),
      });
      return;
    }

    await logProviderDirectoryVisibilityEvent({
      providerId,
      showInDirectory: nextShow,
    });

    revalidatePath("/admin/providers");
    revalidatePath("/admin/providers/pipeline");
  } catch (error) {
    console.error("[admin providers] toggle directory visibility crashed", {
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
    revalidatePath("/admin/providers/pipeline");
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
    revalidatePath("/admin/providers/pipeline");
  } catch (error) {
    console.error("[admin providers] mark contacted crashed", {
      providerId,
      error: serializeActionError(error) ?? PROVIDER_ACTION_ERROR,
    });
  }
}

export async function bulkMarkProvidersContactedAction(args: {
  providerIds: string[];
}): Promise<BulkProviderActionResult> {
  const providerIds = normalizeProviderIds(args.providerIds);
  if (providerIds.length === 0) {
    return { ok: false, error: BULK_PROVIDERS_INPUT_ERROR };
  }

  try {
    await requireAdminUser();

    const [supportsContactedAt, emailColumn] = await Promise.all([
      hasColumns("providers", ["contacted_at"]),
      resolveProviderEmailColumn(),
    ]);

    const selectColumns = [
      "id",
      "name",
      ...(emailColumn ? [emailColumn] : []),
      ...(supportsContactedAt ? ["contacted_at"] : []),
    ].join(",");
    const { data, error } = await supabaseServer
      .from("providers")
      .select(selectColumns)
      .in("id", providerIds)
      .returns<Array<Record<string, string | null>>>();

    if (error) {
      console.error("[admin providers] bulk contacted lookup failed", {
        providerIds,
        error: serializeSupabaseError(error),
      });
      return { ok: false, error: BULK_PROVIDERS_GENERIC_ERROR };
    }

    const rows = Array.isArray(data) ? data : [];
    const rowsById = new Map<string, Record<string, string | null>>();
    const updateCandidates: string[] = [];

    for (const row of rows) {
      const rowId = normalizeText(row.id);
      if (!rowId) continue;
      rowsById.set(rowId, row);
      const contactedAtValue = supportsContactedAt ? normalizeText(row.contacted_at) : "";
      if (!supportsContactedAt || !contactedAtValue) {
        updateCandidates.push(rowId);
      }
    }

    const updateIds = supportsContactedAt
      ? updateCandidates
      : Array.from(rowsById.keys());

    if (supportsContactedAt && updateIds.length > 0) {
      const supported = await schemaGate({
        enabled: true,
        relation: "providers",
        requiredColumns: ["id", "contacted_at"],
        warnPrefix: "[admin providers]",
        warnKey: "admin_providers_bulk_contacted",
      });
      if (supported) {
        const { error: updateError } = await supabaseServer
          .from("providers")
          .update({ contacted_at: new Date().toISOString() })
          .in("id", updateIds);

        if (updateError) {
          console.error("[admin providers] bulk contacted update failed", {
            providerIds,
            error: serializeSupabaseError(updateError),
          });
          return { ok: false, error: BULK_PROVIDERS_GENERIC_ERROR };
        }
      }
    }

    await Promise.all(
      updateIds.map((providerId) => {
        const row = rowsById.get(providerId);
        const providerName = normalizeText(row?.name) || null;
        let providerEmail: string | null = null;
        if (emailColumn) {
          providerEmail = normalizeText(row?.[emailColumn]) || null;
        }
        return logProviderContactedOpsEvent({
          providerId,
          providerName,
          providerEmail,
        });
      }),
    );

    revalidatePath("/admin/providers");
    revalidatePath("/admin/providers/pipeline");

    const updatedCount = updateIds.length;
    const skippedCount = providerIds.length - updatedCount;
    const message =
      updatedCount === 0
        ? "All selected providers are already marked contacted."
        : skippedCount > 0
          ? `Marked ${updatedCount} provider${updatedCount === 1 ? "" : "s"} contacted; ${skippedCount} skipped.`
          : `Marked ${updatedCount} provider${updatedCount === 1 ? "" : "s"} contacted.`;

    return { ok: true, message, updatedCount, skippedCount };
  } catch (error) {
    console.error("[admin providers] bulk contacted crashed", {
      error: serializeActionError(error),
    });
    return { ok: false, error: BULK_PROVIDERS_GENERIC_ERROR };
  }
}

export async function bulkHideProvidersInDirectoryAction(args: {
  providerIds: string[];
}): Promise<BulkProviderActionResult> {
  const providerIds = normalizeProviderIds(args.providerIds);
  if (providerIds.length === 0) {
    return { ok: false, error: BULK_PROVIDERS_INPUT_ERROR };
  }

  try {
    await requireAdminUser();

    const supported = await schemaGate({
      enabled: true,
      relation: "providers",
      requiredColumns: ["id", "show_in_directory"],
      warnPrefix: "[admin providers]",
      warnKey: "admin_providers_bulk_directory",
    });
    if (!supported) {
      return { ok: false, error: BULK_DIRECTORY_VISIBILITY_ERROR };
    }

    const { data, error } = await supabaseServer
      .from("providers")
      .select("id,show_in_directory")
      .in("id", providerIds)
      .returns<Array<{ id: string | null; show_in_directory: boolean | null }>>();

    if (error) {
      console.error("[admin providers] bulk directory lookup failed", {
        providerIds,
        error: serializeSupabaseError(error),
      });
      return { ok: false, error: BULK_PROVIDERS_GENERIC_ERROR };
    }

    const updateIds = (data ?? [])
      .map((row) => ({
        id: normalizeText(row.id),
        show: row?.show_in_directory,
      }))
      .filter((row) => row.id && row.show !== false)
      .map((row) => row.id);

    if (updateIds.length > 0) {
      const { error: updateError } = await supabaseServer
        .from("providers")
        .update({ show_in_directory: false })
        .in("id", updateIds);

      if (updateError) {
        console.error("[admin providers] bulk directory update failed", {
          providerIds,
          error: serializeSupabaseError(updateError),
        });
        return { ok: false, error: BULK_PROVIDERS_GENERIC_ERROR };
      }
    }

    await Promise.all(
      updateIds.map((providerId) =>
        logProviderDirectoryVisibilityEvent({
          providerId,
          showInDirectory: false,
          reason: "bulk_hide",
        }),
      ),
    );

    revalidatePath("/admin/providers");
    revalidatePath("/admin/providers/pipeline");

    const updatedCount = updateIds.length;
    const skippedCount = providerIds.length - updatedCount;
    const message =
      updatedCount === 0
        ? "All selected providers are already hidden in the directory."
        : skippedCount > 0
          ? `Hidden ${updatedCount} provider${updatedCount === 1 ? "" : "s"}; ${skippedCount} skipped.`
          : `Hidden ${updatedCount} provider${updatedCount === 1 ? "" : "s"} in the directory.`;

    return { ok: true, message, updatedCount, skippedCount };
  } catch (error) {
    console.error("[admin providers] bulk directory crashed", {
      error: serializeActionError(error),
    });
    return { ok: false, error: BULK_PROVIDERS_GENERIC_ERROR };
  }
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeProviderIds(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [];
  const normalized = raw
    .map((id) => (typeof id === "string" ? id.trim() : ""))
    .filter((id) => id.length > 0);
  return Array.from(new Set(normalized));
}
