"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth";
import {
  persistQuoteIntake,
  validateQuoteIntakeFields,
  type QuoteIntakeFieldErrors,
  type QuoteIntakePayload,
} from "@/server/quotes/intake";

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

export const initialQuoteIntakeState: QuoteIntakeActionState = {
  ok: false,
  error: "",
};

const SUCCESS_MESSAGE = "RFQ received – we’ll review and follow up shortly.";

export async function submitQuoteIntakeAction(
  _prevState: QuoteIntakeActionState,
  formData: FormData,
): Promise<QuoteIntakeActionState> {
  try {
    const session = await requireSession({
      message: "Sign in to submit RFQs.",
    });

    const parsed = parseQuoteIntakeFormData(formData);
    if ("error" in parsed) {
      return parsed;
    }

    const fieldErrors = validateQuoteIntakeFields(parsed.payload);
    if (Object.keys(fieldErrors).length > 0) {
      return {
        ok: false,
        error: "Please fix the highlighted fields before submitting.",
        fieldErrors,
      };
    }

    const result = await persistQuoteIntake(parsed.payload, session);
    if (!result.ok) {
      return {
        ok: false,
        error:
          result.error ||
          "We couldn’t process your RFQ. Please try again or contact support.",
        fieldErrors: result.fieldErrors,
      };
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
      message: SUCCESS_MESSAGE,
    };
  } catch (error) {
    console.error("[quote intake] action failed", error);
    return {
      ok: false,
      error: "Unexpected error while submitting your RFQ. Please retry.",
    };
  }
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
