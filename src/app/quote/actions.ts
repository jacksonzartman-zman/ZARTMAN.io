"use server";

import { revalidatePath } from "next/cache";
import { createAuthClient, requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  customerUpdateQuotePartFiles,
} from "@/server/customer/quoteParts";
import {
  persistQuoteIntake,
  validateQuoteIntakeFields,
  type QuoteIntakeFieldErrors,
  type QuoteIntakePayload,
} from "@/server/quotes/intake";
import {
  QUOTE_INTAKE_FALLBACK_ERROR,
  QUOTE_INTAKE_SUCCESS_MESSAGE,
} from "@/lib/quote/messages";

export type QuoteIntakeActionState =
  | {
      ok: true;
      quoteId: string | null;
      uploadId: string;
      message: string;
    }
  | {
      ok: false;
      error: string;
      fieldErrors?: QuoteIntakeFieldErrors;
    };

export type CreatePartFromSuggestionState =
  | { ok: true; quoteId: string; quotePartId: string; suggestionKey: string }
  | { ok: false; error: string; suggestionKey: string };

type QuoteRowForSuggestion = {
  id: string;
  customer_id: string | null;
  customer_email: string | null;
};

export async function submitQuoteIntakeAction(
  _prevState: QuoteIntakeActionState,
  formData: FormData,
): Promise<QuoteIntakeActionState> {
  let sessionUserId: string | null = null;
  let attemptedQuoteId: string | null = null;

  try {
    console.log("[quote intake] action invoked");
    const user = await requireUser({
      message: "Sign in to submit RFQs.",
    });
    sessionUserId = user.id;

    const parsed = parseQuoteIntakeFormData(formData);
    if ("error" in parsed) {
      return parsed;
    }

    const fieldErrors = validateQuoteIntakeFields(parsed.payload);
    const fieldErrorKeys = Object.keys(fieldErrors);
    const files = parsed.payload.files ?? [];
    const fileCount = Array.isArray(files) ? files.length : 0;
    const hasFiles = fileCount > 0;
    console.log("[quote intake] parsed payload", {
      hasFiles,
      fileCount,
      email: parsed.payload.email || null,
      fieldErrorCount: fieldErrorKeys.length,
    });
    if (fieldErrorKeys.length > 0) {
      return buildFailureState(
        "Please fix the highlighted fields before submitting.",
        fieldErrors,
      );
    }

    const result = await persistQuoteIntake(parsed.payload, user);
    if (!result.ok) {
      console.warn("[quote intake] persist failed", {
        userId: sessionUserId,
        quoteId: attemptedQuoteId,
        reason: result.error ?? "unknown-error",
        fieldErrors: result.fieldErrors ?? null,
      });
      return buildFailureState(
        result.error ||
          "We couldn’t process your RFQ. Please try again or contact support.",
        result.fieldErrors,
      );
    }

    attemptedQuoteId = result.quoteId ?? null;

    if (!result.uploadId) {
      console.error("[quote intake] missing upload id in success result", {
        userId: sessionUserId,
        quoteId: attemptedQuoteId,
      });
      return buildFailureState(QUOTE_INTAKE_FALLBACK_ERROR);
    }

    revalidatePath("/admin");
    revalidatePath("/admin/quotes");
    revalidatePath("/admin/uploads");
    revalidatePath(`/admin/uploads/${result.uploadId}`);
    if (result.quoteId) {
      revalidatePath(`/admin/quotes/${result.quoteId}`);
    }

    return {
      ok: true,
      quoteId: result.quoteId,
      uploadId: result.uploadId,
      message: QUOTE_INTAKE_SUCCESS_MESSAGE,
    };
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }
    console.error("[quote intake] action failed", {
      userId: sessionUserId,
      quoteId: attemptedQuoteId,
      reason: "unexpected-error",
      error: serializeUnknownError(error),
    });
    return buildFailureState(QUOTE_INTAKE_FALLBACK_ERROR);
  }
}

export async function createPartFromSuggestionAction(
  _prev: CreatePartFromSuggestionState,
  formData: FormData,
): Promise<CreatePartFromSuggestionState> {
  const suggestionKey = String(formData.get("suggestionKey") ?? "").trim();
  const quoteId = String(formData.get("quoteId") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const partNumber = String(formData.get("partNumber") ?? "").trim() || null;
  const fileIds = String(formData.get("fileIds") ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  if (!suggestionKey) {
    return { ok: false, error: "Missing suggestion reference.", suggestionKey: "" };
  }

  if (!quoteId) {
    return { ok: false, error: "Missing quote reference.", suggestionKey };
  }

  if (!label) {
    return { ok: false, error: "Part name is required.", suggestionKey };
  }

  if (fileIds.length === 0) {
    return { ok: false, error: "Select at least one file for this part.", suggestionKey };
  }

  try {
    const user = await requireUser({
      message: "Sign in to add parts.",
    });

    const customer = await getCustomerByUserId(user.id);
    if (!customer) {
      return {
        ok: false,
        error: "Complete your customer profile before adding parts.",
        suggestionKey,
      };
    }

    const { data: quoteRow, error: quoteError } = await supabaseServer
      .from("quotes")
      .select("id,customer_id,customer_email")
      .eq("id", quoteId)
      .maybeSingle<QuoteRowForSuggestion>();

    if (quoteError || !quoteRow?.id) {
      return { ok: false, error: "Quote not found.", suggestionKey };
    }

    const quoteCustomerId =
      typeof quoteRow.customer_id === "string" ? quoteRow.customer_id.trim() : "";
    const quoteCustomerEmail =
      typeof quoteRow.customer_email === "string"
        ? quoteRow.customer_email.trim().toLowerCase()
        : "";
    const customerEmail =
      typeof customer.email === "string" ? customer.email.trim().toLowerCase() : "";

    if (!quoteCustomerId || quoteCustomerId !== customer.id) {
      if (!quoteCustomerEmail || !customerEmail || quoteCustomerEmail !== customerEmail) {
        return { ok: false, error: "You don’t have access to this quote.", suggestionKey };
      }
    }

    // Insert part and return id (needs id so we can attach files immediately).
    const supabase = createAuthClient();
    const { data: partRow, error: partError } = await supabase
      .from("quote_parts")
      .insert({ quote_id: quoteId, part_label: label, part_number: partNumber, notes: null })
      .select("id")
      .single<{ id: string }>();

    if (partError || !partRow?.id) {
      return { ok: false, error: "Could not create part. Please try again.", suggestionKey };
    }

    await customerUpdateQuotePartFiles({
      quoteId,
      quotePartId: partRow.id,
      addFileIds: fileIds,
      removeFileIds: [],
    });

    revalidatePath(`/customer/quotes/${quoteId}`);
    return { ok: true, quoteId, quotePartId: partRow.id, suggestionKey };
  } catch (error) {
    console.error("[suggested parts] create part failed", error);
    return { ok: false, error: "Could not add suggested part. Please try again.", suggestionKey };
  }
}

function buildFailureState(
  message: string,
  fieldErrors?: QuoteIntakeFieldErrors,
): QuoteIntakeActionState {
  return {
    ok: false,
    error: message,
    fieldErrors:
      fieldErrors && Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined,
  };
}

function serializeUnknownError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { value: error };
}

function isNextRedirectError(error: unknown): error is { digest?: string } {
  if (!error || typeof error !== "object") {
    return false;
  }
  const digest = "digest" in error ? (error as { digest?: unknown }).digest : null;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

function parseQuoteIntakeFormData(
  formData: FormData,
):
  | { payload: QuoteIntakePayload }
  | { ok: false; error: string; fieldErrors: QuoteIntakeFieldErrors } {
  const files = collectFormDataFiles(formData);
  if (files.length === 0) {
    return {
      ok: false,
      error: "Attach at least one CAD file before submitting.",
      fieldErrors: { file: "Attach at least one CAD file before submitting." },
    };
  }

  const payload: QuoteIntakePayload = {
    files,
    firstName: getString(formData, "firstName"),
    lastName: getString(formData, "lastName"),
    email: getString(formData, "email"),
    company: getString(formData, "company"),
    phone: getString(formData, "phone"),
    manufacturingProcess: getString(formData, "manufacturingProcess"),
    quantity: getString(formData, "quantity"),
    shippingPostalCode: getString(formData, "shippingPostalCode"),
    exportRestriction: getString(formData, "exportRestriction"),
    rfqReason: getString(formData, "rfqReason"),
    notes: getString(formData, "notes"),
    itarAcknowledged: parseBoolean(formData.get("itarAcknowledged")),
    termsAccepted: parseBoolean(formData.get("termsAccepted")),
  };

  return { payload };
}

function collectFormDataFiles(formData: FormData): File[] {
  const collected: File[] = [];
  const appendIfFile = (value: FormDataEntryValue | null) => {
    if (value instanceof File) {
      collected.push(value);
    }
  };

  const multi = formData.getAll("files");
  if (multi && multi.length > 0) {
    multi.forEach((value) => appendIfFile(value));
  }

  if (collected.length === 0) {
    appendIfFile(formData.get("file"));
  }

  return collected;
}

function getString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function parseBoolean(value: FormDataEntryValue | null): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "on";
}
