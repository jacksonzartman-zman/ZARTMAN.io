"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth";
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

export async function submitQuoteIntakeAction(
  _prevState: QuoteIntakeActionState,
  formData: FormData,
): Promise<QuoteIntakeActionState> {
  let sessionUserId: string | null = null;
  let attemptedQuoteId: string | null = null;

  try {
    console.log("[quote intake] submit action invoked");
    const session = await requireSession({
      message: "Sign in to submit RFQs.",
    });
    sessionUserId = session.user.id;

    const parsed = parseQuoteIntakeFormData(formData);
    if ("error" in parsed) {
      return parsed;
    }

    const fieldErrors = validateQuoteIntakeFields(parsed.payload);
    const fieldErrorKeys = Object.keys(fieldErrors);
    console.log("[quote intake] parsed payload", {
      hasFile: Boolean(parsed.payload.file),
      email: parsed.payload.email || null,
      fieldErrorCount: fieldErrorKeys.length,
    });
    if (fieldErrorKeys.length > 0) {
      return buildFailureState(
        "Please fix the highlighted fields before submitting.",
        fieldErrors,
      );
    }

    const result = await persistQuoteIntake(parsed.payload, session);
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
  const fileEntry = formData.get("file");
  if (!(fileEntry instanceof File)) {
    return {
      ok: false,
      error: "Attach your CAD file before submitting.",
      fieldErrors: { file: "Attach your CAD file before submitting." },
    };
  }

  const payload: QuoteIntakePayload = {
    file: fileEntry,
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
