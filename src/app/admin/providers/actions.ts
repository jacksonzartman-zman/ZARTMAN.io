"use server";

import { revalidatePath } from "next/cache";
import { getFormString, serializeActionError } from "@/lib/forms";
import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";
import { requestMagicLinkForEmail } from "@/app/auth/actions";
import { serializeSupabaseError } from "@/server/admin/logging";
import {
  logProviderContactedOpsEvent,
  logProviderRespondedOpsEvent,
  logProviderDirectoryVisibilityEvent,
  logProviderStatusOpsEvent,
} from "@/server/ops/events";
import { resolveProviderEmailColumn } from "@/server/providers";
import { hasColumns, schemaGate } from "@/server/db/schemaContract";
import { getOrCreateSupplierByEmail, loadSupplierByPrimaryEmail } from "@/server/suppliers/profile";

const PROVIDER_ACTION_ERROR = "We couldn't update this provider right now.";
const BULK_PROVIDERS_INPUT_ERROR = "Select at least one provider.";
const BULK_PROVIDERS_GENERIC_ERROR = "We couldn't update these providers right now.";
const BULK_DIRECTORY_VISIBILITY_ERROR = "Directory visibility isn't available yet.";
const BULK_NOTES_ERROR = "Response summary is required.";

export type InviteSupplierActionState =
  | { status?: undefined }
  | { status: "success"; message: string }
  | { status: "error"; error: string };

export const INVITE_SUPPLIER_INITIAL_STATE: InviteSupplierActionState = {};

export type BulkProviderActionResult =
  | { ok: true; message: string; updatedCount: number; skippedCount: number }
  | { ok: false; error: string };

export async function markProviderRespondedAction(formData: FormData): Promise<void> {
  const providerId = normalizeId(getFormString(formData, "providerId"));
  const channel = normalizeChannel(getFormString(formData, "channel"));
  const summary = normalizeText(getFormString(formData, "summary"));
  const rawNotes = normalizeOptionalText(getFormString(formData, "rawNotes"));
  const appendToNotes = normalizeBool(getFormString(formData, "appendToNotes"), true);
  if (!providerId) return;
  if (!channel) return;
  if (!summary) return;

  try {
    const adminUser = await requireAdminUser();
    const responderUserId = normalizeId((adminUser as any)?.id);
    const responseAt = new Date().toISOString();

    const supportsProviderResponses = await schemaGate({
      enabled: true,
      relation: "provider_responses",
      requiredColumns: [
        "provider_id",
        "response_at",
        "channel",
        "summary",
        "raw_notes",
        "responder_user_id",
      ],
      warnPrefix: "[admin providers]",
      warnKey: "admin_providers_provider_responses_insert",
    });

    if (supportsProviderResponses) {
      try {
        const { error } = await supabaseServer().from("provider_responses").insert({
          provider_id: providerId,
          response_at: responseAt,
          channel,
          summary,
          raw_notes: rawNotes,
          responder_user_id: responderUserId || null,
        });
        if (error) {
          console.error("[admin providers] provider response insert failed", {
            providerId,
            error: serializeSupabaseError(error),
          });
        }
      } catch (error) {
        console.error("[admin providers] provider response insert crashed", {
          providerId,
          error: serializeActionError(error),
        });
      }
    }

    if (appendToNotes) {
      const supportsNotes = await hasColumns("providers", ["notes"]);
      if (supportsNotes) {
        const supported = await schemaGate({
          enabled: true,
          relation: "providers",
          requiredColumns: ["id", "notes"],
          warnPrefix: "[admin providers]",
          warnKey: "admin_providers_mark_responded_notes",
        });
        if (supported) {
          let existingNotes: string | null = null;
          try {
            const { data, error } = await supabaseServer()
              .from("providers")
              .select("id,notes")
              .eq("id", providerId)
              .maybeSingle<{ id: string | null; notes: string | null }>();
            if (!error && data) {
              existingNotes = normalizeOptionalText(data.notes);
            }
          } catch (error) {
            console.warn("[admin providers] responded notes lookup failed", {
              providerId,
              error: serializeActionError(error),
            });
          }

          const merged = mergeNotesWithResponse(existingNotes, buildProviderResponseNotesLine({ channel, summary }));
          const { error } = await supabaseServer()
            .from("providers")
            .update({ notes: merged })
            .eq("id", providerId);

          if (error) {
            console.error("[admin providers] mark responded notes append failed", {
              providerId,
              error: serializeSupabaseError(error),
            });
          }
        }
      }
    }

    await logProviderRespondedOpsEvent({
      providerId,
      responseNotes: buildProviderResponseNotesLine({ channel, summary }),
    });

    revalidatePath("/admin/providers");
    revalidatePath("/admin/providers/pipeline");
  } catch (error) {
    console.error("[admin providers] mark responded crashed", {
      providerId,
      error: serializeActionError(error),
    });
  }
}

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
    const { error } = await supabaseServer()
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

    const { error } = await supabaseServer()
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

    const { error } = await supabaseServer()
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

    const { error } = await supabaseServer()
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

    const { error } = await supabaseServer()
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
      const { data, error } = await supabaseServer()
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
        const { error } = await supabaseServer()
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
    const { data, error } = await supabaseServer()
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
        const { error: updateError } = await supabaseServer()
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

    const { data, error } = await supabaseServer()
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
      const { error: updateError } = await supabaseServer()
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

export async function bulkShowProvidersInDirectoryAction(args: {
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
      warnKey: "admin_providers_bulk_show_directory",
    });
    if (!supported) {
      return { ok: false, error: BULK_DIRECTORY_VISIBILITY_ERROR };
    }

    const { data, error } = await supabaseServer()
      .from("providers")
      .select("id,show_in_directory")
      .in("id", providerIds)
      .returns<Array<{ id: string | null; show_in_directory: boolean | null }>>();

    if (error) {
      console.error("[admin providers] bulk show directory lookup failed", {
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
      .filter((row) => row.id && row.show !== true)
      .map((row) => row.id);

    if (updateIds.length > 0) {
      const { error: updateError } = await supabaseServer()
        .from("providers")
        .update({ show_in_directory: true })
        .in("id", updateIds);

      if (updateError) {
        console.error("[admin providers] bulk show directory update failed", {
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
          showInDirectory: true,
          reason: "bulk_show",
        }),
      ),
    );

    revalidatePath("/admin/providers");
    revalidatePath("/admin/providers/pipeline");

    const updatedCount = updateIds.length;
    const skippedCount = providerIds.length - updatedCount;
    const message =
      updatedCount === 0
        ? "All selected providers are already visible in the directory."
        : skippedCount > 0
          ? `Shown ${updatedCount} provider${updatedCount === 1 ? "" : "s"}; ${skippedCount} skipped.`
          : `Shown ${updatedCount} provider${updatedCount === 1 ? "" : "s"} in the directory.`;

    return { ok: true, message, updatedCount, skippedCount };
  } catch (error) {
    console.error("[admin providers] bulk show directory crashed", {
      error: serializeActionError(error),
    });
    return { ok: false, error: BULK_PROVIDERS_GENERIC_ERROR };
  }
}

export async function bulkActivateProvidersAction(args: {
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
      requiredColumns: ["id", "is_active"],
      warnPrefix: "[admin providers]",
      warnKey: "admin_providers_bulk_activate",
    });
    if (!supported) {
      return { ok: false, error: BULK_PROVIDERS_GENERIC_ERROR };
    }

    const { data, error } = await supabaseServer()
      .from("providers")
      .select("id,is_active")
      .in("id", providerIds)
      .returns<Array<{ id: string | null; is_active: boolean | null }>>();

    if (error) {
      console.error("[admin providers] bulk activate lookup failed", {
        providerIds,
        error: serializeSupabaseError(error),
      });
      return { ok: false, error: BULK_PROVIDERS_GENERIC_ERROR };
    }

    const updateIds = (data ?? [])
      .map((row) => ({
        id: normalizeText(row.id),
        active: row?.is_active,
      }))
      .filter((row) => row.id && row.active !== true)
      .map((row) => row.id);

    if (updateIds.length > 0) {
      const { error: updateError } = await supabaseServer()
        .from("providers")
        .update({ is_active: true })
        .in("id", updateIds);

      if (updateError) {
        console.error("[admin providers] bulk activate update failed", {
          providerIds,
          error: serializeSupabaseError(updateError),
        });
        return { ok: false, error: BULK_PROVIDERS_GENERIC_ERROR };
      }
    }

    await Promise.all(
      updateIds.map((providerId) =>
        logProviderStatusOpsEvent({
          providerId,
          eventType: "provider_activated",
          snapshot: { is_active: true },
        }),
      ),
    );

    revalidatePath("/admin/providers");
    revalidatePath("/admin/providers/pipeline");

    const updatedCount = updateIds.length;
    const skippedCount = providerIds.length - updatedCount;
    const message =
      updatedCount === 0
        ? "All selected providers are already active."
        : skippedCount > 0
          ? `Activated ${updatedCount} provider${updatedCount === 1 ? "" : "s"}; ${skippedCount} skipped.`
          : `Activated ${updatedCount} provider${updatedCount === 1 ? "" : "s"}.`;

    return { ok: true, message, updatedCount, skippedCount };
  } catch (error) {
    console.error("[admin providers] bulk activate crashed", {
      error: serializeActionError(error),
    });
    return { ok: false, error: BULK_PROVIDERS_GENERIC_ERROR };
  }
}

export async function bulkMarkProvidersRespondedAction(args: {
  providerIds: string[];
  channel: string;
  summary: string;
  rawNotes?: string | null;
  appendToNotes?: boolean;
}): Promise<BulkProviderActionResult> {
  const providerIds = normalizeProviderIds(args.providerIds);
  const channel = normalizeChannel(args.channel);
  const summary = normalizeText(args.summary);
  const rawNotes = normalizeOptionalText(args.rawNotes);
  const appendToNotes = typeof args.appendToNotes === "boolean" ? args.appendToNotes : true;
  if (providerIds.length === 0) {
    return { ok: false, error: BULK_PROVIDERS_INPUT_ERROR };
  }
  if (!channel) {
    return { ok: false, error: BULK_PROVIDERS_GENERIC_ERROR };
  }
  if (!summary) {
    return { ok: false, error: BULK_NOTES_ERROR };
  }

  try {
    const adminUser = await requireAdminUser();
    const responderUserId = normalizeId((adminUser as any)?.id);
    const responseAt = new Date().toISOString();
    const notesLine = buildProviderResponseNotesLine({ channel, summary });

    const supportsProviderResponses = await schemaGate({
      enabled: true,
      relation: "provider_responses",
      requiredColumns: [
        "provider_id",
        "response_at",
        "channel",
        "summary",
        "raw_notes",
        "responder_user_id",
      ],
      warnPrefix: "[admin providers]",
      warnKey: "admin_providers_provider_responses_bulk_insert",
    });

    if (supportsProviderResponses) {
      try {
        const { error: insertError } = await supabaseServer().from("provider_responses").insert(
          providerIds.map((providerId) => ({
            provider_id: providerId,
            response_at: responseAt,
            channel,
            summary,
            raw_notes: rawNotes,
            responder_user_id: responderUserId || null,
          })),
        );
        if (insertError) {
          console.error("[admin providers] bulk provider response insert failed", {
            providerIds,
            error: serializeSupabaseError(insertError),
          });
        }
      } catch (error) {
        console.error("[admin providers] bulk provider response insert crashed", {
          error: serializeActionError(error),
        });
      }
    }

    const supportsNotes = await hasColumns("providers", ["notes"]);
    const selectColumns = ["id", ...(supportsNotes ? ["notes"] : [])].join(",");
    const { data, error } = await supabaseServer()
      .from("providers")
      .select(selectColumns)
      .in("id", providerIds)
      .returns<Array<Record<string, string | null>>>();

    if (error) {
      console.error("[admin providers] bulk responded lookup failed", {
        providerIds,
        error: serializeSupabaseError(error),
      });
      return { ok: false, error: BULK_PROVIDERS_GENERIC_ERROR };
    }

    const rows = Array.isArray(data) ? data : [];
    const updateIds: string[] = [];

    if (supportsNotes && appendToNotes) {
      const supported = await schemaGate({
        enabled: true,
        relation: "providers",
        requiredColumns: ["id", "notes"],
        warnPrefix: "[admin providers]",
        warnKey: "admin_providers_bulk_responded",
      });
      if (supported) {
        await Promise.all(
          rows.map(async (row) => {
            const id = normalizeText(row?.id);
            if (!id) return;
            const existingNotes = normalizeOptionalText(row?.notes);
            const merged = mergeNotesWithResponse(existingNotes, notesLine);
            const { error: updateError } = await supabaseServer()
              .from("providers")
              .update({ notes: merged })
              .eq("id", id);
            if (!updateError) {
              updateIds.push(id);
              return;
            }
            console.error("[admin providers] bulk responded update failed", {
              providerId: id,
              error: serializeSupabaseError(updateError),
            });
          }),
        );
      }
    } else {
      // No notes column; count as updated for ops-event purposes.
      for (const row of rows) {
        const id = normalizeText(row?.id);
        if (id) updateIds.push(id);
      }
    }

    await Promise.all(
      updateIds.map((providerId) =>
        logProviderRespondedOpsEvent({
          providerId,
          responseNotes: notesLine,
        }),
      ),
    );

    revalidatePath("/admin/providers");
    revalidatePath("/admin/providers/pipeline");

    const updatedCount = updateIds.length;
    const skippedCount = providerIds.length - updatedCount;
    const message =
      updatedCount === 0
        ? "No selected providers were updated."
        : skippedCount > 0
          ? `Marked ${updatedCount} provider${updatedCount === 1 ? "" : "s"} responded; ${skippedCount} skipped.`
          : `Marked ${updatedCount} provider${updatedCount === 1 ? "" : "s"} responded.`;

    return { ok: true, message, updatedCount, skippedCount };
  } catch (error) {
    console.error("[admin providers] bulk responded crashed", {
      error: serializeActionError(error),
    });
    return { ok: false, error: BULK_PROVIDERS_GENERIC_ERROR };
  }
}

export async function inviteSupplierAction(
  _prevState: InviteSupplierActionState,
  formData: FormData,
): Promise<InviteSupplierActionState> {
  const supplierName = normalizeText(getFormString(formData, "supplierName"));
  const email = normalizeEmail(getFormString(formData, "email"));
  const processes = normalizeStringList(formData.getAll("processes"));

  if (!supplierName) {
    return { status: "error", error: "Supplier name is required." };
  }
  if (!email) {
    return { status: "error", error: "Enter a valid email address." };
  }

  try {
    await requireAdminUser();

    const { providerId, providerError } = await upsertInvitedSupplierProvider({
      supplierName,
      email,
      processes,
    });
    if (!providerId) {
      return { status: "error", error: providerError ?? "We couldn't create the provider record." };
    }

    const supplier = await getOrCreateSupplierByEmail(email, supplierName, null);

    const supportsProviderId = await hasColumns("suppliers", ["provider_id"]);
    const supportsStatus = await hasColumns("suppliers", ["status"]);
    const updatePayload: Record<string, unknown> = {
      company_name: supplierName,
      primary_email: email,
      verified: true,
      ...(supportsProviderId ? { provider_id: providerId } : {}),
      ...(supportsStatus ? { status: "approved" } : {}),
    };

    const updateSupported = await schemaGate({
      enabled: true,
      relation: "suppliers",
      requiredColumns: ["id", ...Object.keys(updatePayload)],
      warnPrefix: "[admin providers]",
      warnKey: "admin_providers_invite_supplier_update_supplier",
    });
    if (updateSupported) {
      const { error: supplierUpdateError } = await supabaseServer()
        .from("suppliers")
        .update(updatePayload)
        .eq("id", supplier.id);
      if (supplierUpdateError) {
        console.error("[admin providers] supplier update failed", {
          supplierId: supplier.id,
          email,
          error: serializeSupabaseError(supplierUpdateError) ?? supplierUpdateError,
        });
      }
    }

    const magic = await requestMagicLinkForEmail({
      role: "supplier",
      email,
      nextPath: "/supplier?invited=1",
    });
    if (!magic.ok) {
      return { status: "error", error: magic.error };
    }

    revalidatePath("/admin/providers");
    return { status: "success", message: `Invite sent to ${email}.` };
  } catch (error) {
    console.error("[admin providers] invite supplier crashed", {
      error: serializeActionError(error),
    });
    return { status: "error", error: "We couldn't send that invite right now." };
  }
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) return null;
  return normalized;
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

function mergeNotesWithResponse(existingNotes: string | null, responseLine: string): string {
  const existing = normalizeOptionalText(existingNotes);
  const line = normalizeText(responseLine);
  if (!line) return existing ?? "";
  if (!existing) {
    return line;
  }
  if (existing.includes(line)) {
    return existing;
  }
  return `${existing}\n${line}`;
}

function normalizeChannel(value: unknown): "email" | "call" | "form" | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "email" || normalized === "call" || normalized === "form") return normalized;
  return null;
}

function normalizeBool(value: unknown, fallback: boolean): boolean {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "on" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "off" || normalized === "0" || normalized === "no") return false;
  return fallback;
}

function buildProviderResponseNotesLine(args: {
  channel: "email" | "call" | "form";
  summary: string;
}): string {
  const summary = normalizeText(args.summary);
  const label = args.channel === "form" ? "web form" : args.channel;
  const truncated = summary.length > 200 ? `${summary.slice(0, 200)}…` : summary;
  // Prefix kept consistent so legacy "notes tag" fallback continues to work.
  return `Response: (${label}) ${truncated}`.trim();
}

function normalizeProviderIds(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [];
  const normalized = raw
    .map((id) => (typeof id === "string" ? id.trim() : ""))
    .filter((id) => id.length > 0);
  return Array.from(new Set(normalized));
}

function normalizeStringList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const normalized = values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  return Array.from(new Set(normalized));
}

async function upsertInvitedSupplierProvider(args: {
  supplierName: string;
  email: string;
  processes: string[];
}): Promise<{ providerId: string | null; providerError?: string }> {
  const supported = await schemaGate({
    enabled: true,
    relation: "providers",
    requiredColumns: ["id", "name", "provider_type", "quoting_mode", "is_active"],
    warnPrefix: "[admin providers]",
    warnKey: "admin_providers_invite_supplier_provider_schema",
  });
  if (!supported) {
    return { providerId: null, providerError: "Provider schema unavailable." };
  }

  const normalizedProcesses = args.processes
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.toLowerCase());

  let providerId: string | null = null;
  try {
    const supplier = await loadSupplierByPrimaryEmail(args.email);
    const linkedProviderId =
      typeof (supplier as any)?.provider_id === "string" ? (supplier as any).provider_id.trim() : "";
    if (linkedProviderId) {
      providerId = linkedProviderId;
    }
  } catch {
    // ignore
  }

  const [emailColumn, supportsProcesses, supportsVerificationStatus, supportsVerifiedAt, supportsSource] =
    await Promise.all([
      resolveProviderEmailColumn(),
      hasColumns("providers", ["processes"]),
      hasColumns("providers", ["verification_status"]),
      hasColumns("providers", ["verified_at"]),
      hasColumns("providers", ["source"]),
    ]);

  if (!providerId && emailColumn) {
    const lookupSupported = await schemaGate({
      enabled: true,
      relation: "providers",
      requiredColumns: ["id", emailColumn],
      warnPrefix: "[admin providers]",
      warnKey: "admin_providers_invite_supplier_provider_lookup",
    });
    if (lookupSupported) {
      const { data } = await supabaseServer()
        .from("providers")
        .select(`id,${emailColumn}`)
        .eq(emailColumn, args.email)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string | null }>();
      providerId = typeof data?.id === "string" ? data.id.trim() : null;
    }
  }

  const payload: Record<string, unknown> = {
    name: args.supplierName,
    provider_type: "direct_supplier",
    quoting_mode: "manual",
    is_active: true,
    ...(supportsVerificationStatus ? { verification_status: "verified" } : {}),
    ...(supportsVerifiedAt ? { verified_at: new Date().toISOString() } : {}),
    ...(supportsSource ? { source: "manual" } : {}),
    ...(supportsProcesses ? { processes: normalizedProcesses } : {}),
    ...(emailColumn ? { [emailColumn]: args.email } : {}),
  };

  try {
    if (providerId) {
      const updateSupported = await schemaGate({
        enabled: true,
        relation: "providers",
        requiredColumns: ["id", ...Object.keys(payload)],
        warnPrefix: "[admin providers]",
        warnKey: "admin_providers_invite_supplier_provider_update",
      });
      if (!updateSupported) {
        return { providerId: null, providerError: "Provider schema unavailable." };
      }
      const { error } = await supabaseServer().from("providers").update(payload).eq("id", providerId);
      if (error) {
        console.error("[admin providers] provider update failed", {
          providerId,
          email: args.email,
          error: serializeSupabaseError(error) ?? error,
        });
        return { providerId: null, providerError: "Unable to update provider." };
      }
      return { providerId };
    }

    const insertSupported = await schemaGate({
      enabled: true,
      relation: "providers",
      requiredColumns: ["name", "provider_type", "quoting_mode", "is_active"],
      warnPrefix: "[admin providers]",
      warnKey: "admin_providers_invite_supplier_provider_insert",
    });
    if (!insertSupported) {
      return { providerId: null, providerError: "Provider schema unavailable." };
    }

    const { data, error } = await supabaseServer()
      .from("providers")
      .insert(payload)
      .select("id")
      .maybeSingle<{ id: string | null }>();
    if (error) {
      console.error("[admin providers] provider insert failed", {
        email: args.email,
        error: serializeSupabaseError(error) ?? error,
      });
      return { providerId: null, providerError: "Unable to create provider." };
    }
    const insertedId = typeof data?.id === "string" ? data.id.trim() : "";
    return { providerId: insertedId || null };
  } catch (error) {
    console.error("[admin providers] provider upsert crashed", {
      email: args.email,
      error: serializeActionError(error),
    });
    return { providerId: null, providerError: "Unable to create provider." };
  }
}
