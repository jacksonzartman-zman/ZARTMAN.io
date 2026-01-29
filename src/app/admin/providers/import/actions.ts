"use server";

import { revalidatePath } from "next/cache";
import { getFormString, serializeActionError } from "@/lib/forms";
import { parseProviderImportCsv } from "@/lib/providerImport";
import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";
import { serializeSupabaseError } from "@/server/admin/logging";
import { hasColumns, schemaGate } from "@/server/db/schemaContract";
import type { ProviderImportActionState } from "./providerImportActionState";

const PROVIDER_IMPORT_GENERIC_ERROR =
  "We couldn't import providers right now. Please try again.";
const PROVIDER_IMPORT_EMPTY_ERROR = "Paste CSV data to import providers.";
const PROVIDER_IMPORT_VALIDATION_ERROR =
  "Fix the validation errors before importing.";

export async function importProvidersAction(
  _prevState: ProviderImportActionState,
  formData: FormData,
): Promise<ProviderImportActionState> {
  const csvInput = getFormString(formData, "csv");
  const csvText = typeof csvInput === "string" ? csvInput : "";

  if (!csvText.trim()) {
    return { ok: false, error: PROVIDER_IMPORT_EMPTY_ERROR };
  }

  const parseResult = parseProviderImportCsv(csvText);
  if (parseResult.rows.length === 0) {
    return { ok: false, error: PROVIDER_IMPORT_EMPTY_ERROR };
  }
  if (parseResult.validRows.length !== parseResult.rows.length) {
    return { ok: false, error: PROVIDER_IMPORT_VALIDATION_ERROR };
  }

  try {
    await requireAdminUser();

    const supported = await schemaGate({
      enabled: true,
      relation: "providers",
      requiredColumns: [
        "name",
        "provider_type",
        "quoting_mode",
        "is_active",
        "verification_status",
        "source",
      ],
      warnPrefix: "[admin providers import]",
      warnKey: "admin_providers_import",
    });
    if (!supported) {
      return { ok: false, error: PROVIDER_IMPORT_GENERIC_ERROR };
    }

    const [
      supportsWebsite,
      supportsNotes,
      supportsPrimaryEmail,
      supportsEmail,
      supportsContactEmail,
      supportsDispatchMode,
      supportsRfqUrl,
    ] = await Promise.all([
      hasColumns("providers", ["website"]),
      hasColumns("providers", ["notes"]),
      hasColumns("providers", ["primary_email"]),
      hasColumns("providers", ["email"]),
      hasColumns("providers", ["contact_email"]),
      hasColumns("providers", ["dispatch_mode"]),
      hasColumns("providers", ["rfq_url"]),
    ]);

    const emailColumn = supportsPrimaryEmail
      ? "primary_email"
      : supportsEmail
        ? "email"
        : supportsContactEmail
          ? "contact_email"
          : null;

    const payloads = parseResult.validRows.map((row) => {
      const hasWebForm = Boolean(row.rfqUrl);
      const payload: Record<string, unknown> = {
        name: row.name,
        provider_type: row.providerType,
        quoting_mode: "email",
        is_active: false,
        verification_status: "unverified",
        source: "csv_import",
      };

      if (supportsWebsite) {
        payload.website = row.website ?? null;
      }
      if (supportsDispatchMode) {
        payload.dispatch_mode = hasWebForm ? "web_form" : "email";
      }
      if (supportsRfqUrl && row.rfqUrl) {
        payload.rfq_url = row.rfqUrl;
      }

      if (emailColumn) {
        payload[emailColumn] = row.email ?? null;
      } else if (supportsNotes && row.email) {
        payload.notes = `Contact email: ${row.email}`;
      }

      return payload;
    });

    const { error } = await supabaseServer().from("providers").insert(payloads);
    if (error) {
      console.error("[admin providers import] insert failed", {
        error: serializeSupabaseError(error),
      });
      return { ok: false, error: PROVIDER_IMPORT_GENERIC_ERROR };
    }

    revalidatePath("/admin/providers/import");

    return {
      ok: true,
      message: `Imported ${payloads.length} provider${payloads.length === 1 ? "" : "s"}.`,
      createdCount: payloads.length,
    };
  } catch (error) {
    console.error("[admin providers import] action crashed", {
      error: serializeActionError(error),
    });
    return { ok: false, error: PROVIDER_IMPORT_GENERIC_ERROR };
  }
}
