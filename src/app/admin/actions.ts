// src/app/admin/quotes/actions.ts

"use server";

import { isRedirectError } from "next/dist/client/components/redirect-error";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  DEFAULT_UPLOAD_STATUS,
  normalizeUploadStatus,
  parseUploadStatusInput,
  type UploadStatus,
} from "./constants";

export async function updateQuote(formData: FormData) {
  const supabase = supabaseServer;

  const id = formData.get("id") as string;

  const statusValue =
    parseUploadStatusInput(formData.get("status")) ?? DEFAULT_UPLOAD_STATUS;
  const priceRaw = formData.get("price") as string;
  const currency = formData.get("currency") as string;
  const targetDate = formData.get("target_date") as string;
  const internalNotes = formData.get("internal_notes") as string;
  const dfmNotes = formData.get("dfm_notes") as string | null;

  const price = priceRaw && priceRaw.length > 0 ? parseFloat(priceRaw) : null;

  const { data: updatedQuote, error } = await supabase
    .from("quotes")
    .update({
      status: statusValue,
      price,
      currency,
      target_date: targetDate || null,
      internal_notes: internalNotes || null,
      dfm_notes:
        typeof dfmNotes === "string" && dfmNotes.trim().length > 0
          ? dfmNotes
          : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("upload_id")
    .maybeSingle<{ upload_id: string | null }>();

  if (error) {
    console.error("Quote update error", error);
    throw new Error("Failed to update quote.");
  }

  if (updatedQuote?.upload_id) {
    const { error: uploadSyncError } = await supabase
      .from("uploads")
      .update({
        status: statusValue,
        quote_id: id,
      })
      .eq("id", updatedQuote.upload_id);

    if (uploadSyncError) {
      console.error("Failed to sync upload status with quote", uploadSyncError);
    } else {
      revalidatePath(`/admin/uploads/${updatedQuote.upload_id}`);
    }
  }

  revalidatePath("/admin");
  return redirect(`/admin/quotes/${id}?updated=1`);
}

export type QuoteFormState = {
  error?: string;
};

export async function handleQuoteFormSubmit(
  _prevState: QuoteFormState,
  formData: FormData,
): Promise<QuoteFormState> {
  try {
    await updateQuote(formData);
    return {};
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    console.error("handleQuoteFormSubmit error", error);
    return { error: "Failed to save changes. Please try again." };
  }
}

export type CreateQuoteActionState = {
  error?: string;
};

type UploadForQuote = {
  id: string;
  quote_id: string | null;
  customer_id: string | null;
  status: UploadStatus | null;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company: string | null;
  file_name: string | null;
};

type QuoteLookupRow = {
  id: string;
  status: UploadStatus | null;
};

async function syncUploadQuoteLink(
  uploadId: string,
  quoteId: string,
  status: UploadStatus,
) {
  const { error } = await supabaseServer
    .from("uploads")
    .update({
      quote_id: quoteId,
      status,
    })
    .eq("id", uploadId);

  if (error) {
    console.error("Failed to sync upload.quote_id after quote creation", {
      uploadId,
      quoteId,
      status,
      error,
    });
    return false;
  }

  return true;
}

export async function createQuoteFromUploadAction(
  _prevState: CreateQuoteActionState,
  formData: FormData,
): Promise<CreateQuoteActionState> {
  const rawUploadId = formData.get("upload_id");

  if (typeof rawUploadId !== "string" || rawUploadId.trim().length === 0) {
    return { error: "Missing upload ID, please refresh and try again." };
  }

  const uploadId = rawUploadId.trim();

  try {
      const { data: upload, error: uploadError } = await supabaseServer
        .from("uploads")
        .select(
          "id, quote_id, customer_id, status, name, first_name, last_name, email, company, file_name",
        )
        .eq("id", uploadId)
        .maybeSingle<UploadForQuote>();

    if (uploadError || !upload) {
        console.error("createQuoteFromUpload: upload lookup failed", {
          uploadId,
          error: uploadError,
        });
      return { error: "Could not create quote, please try again." };
    }

    if (upload.quote_id) {
      revalidatePath("/admin");
      revalidatePath(`/admin/uploads/${uploadId}`);
      return redirect(`/admin/quotes/${upload.quote_id}`);
    }

    const desiredStatus = normalizeUploadStatus(
      upload.status,
      DEFAULT_UPLOAD_STATUS,
    );

    const { data: existingQuote, error: existingQuoteError } =
      await supabaseServer
        .from("quotes")
        .select("id,status")
        .eq("upload_id", uploadId)
        .maybeSingle<QuoteLookupRow>();

    if (existingQuoteError) {
      console.error(
        "createQuoteFromUpload: existing quote lookup failed",
        existingQuoteError,
      );
    }

    if (existingQuote?.id) {
      const normalizedExistingStatus = normalizeUploadStatus(
        existingQuote.status,
        desiredStatus,
      );
      const linked = await syncUploadQuoteLink(
        uploadId,
        existingQuote.id,
        normalizedExistingStatus,
      );
      if (!linked) {
        return {
          error:
            "Found an existing quote, but linking it to the upload failed. Please retry.",
        };
      }
      revalidatePath("/admin");
      revalidatePath(`/admin/uploads/${uploadId}`);
      return redirect(`/admin/quotes/${existingQuote.id}`);
    }

      const contactPieces = [upload.first_name, upload.last_name]
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => value.length > 0);
      const fallbackName =
        typeof upload.name === "string" && upload.name.trim().length > 0
          ? upload.name.trim()
          : "";
      const fallbackEmail =
        typeof upload.email === "string" && upload.email.trim().length > 0
          ? upload.email.trim()
          : "";
      const customerNameForQuote =
        contactPieces.join(" ").trim() ||
        fallbackName ||
        fallbackEmail ||
        "RFQ contact";
      const sanitizedCompany =
        typeof upload.company === "string" && upload.company.trim().length > 0
          ? upload.company.trim()
          : null;
      const sanitizedEmail = fallbackEmail || null;
      const sanitizedFileName =
        typeof upload.file_name === "string" && upload.file_name.trim().length > 0
          ? upload.file_name.trim()
          : null;

      const quoteInsertPayload = {
        upload_id: uploadId,
        customer_id: upload.customer_id ?? undefined,
        customer_name: customerNameForQuote,
        customer_email: sanitizedEmail,
        company: sanitizedCompany,
        file_name: sanitizedFileName,
        status: desiredStatus,
        currency: "USD",
        internal_notes: `Created from upload ${uploadId}`,
      };

      const { data: newQuote, error: insertError } = await supabaseServer
        .from("quotes")
        .insert(quoteInsertPayload)
        .select("id")
        .single<{ id: string }>();

    if (insertError || !newQuote) {
        console.error("createQuoteFromUpload: insert failed", {
          uploadId,
          payload: quoteInsertPayload,
          error: insertError,
        });
      return { error: "Could not create quote, please try again." };
    }

    const linked = await syncUploadQuoteLink(
      uploadId,
      newQuote.id,
      desiredStatus,
    );

    if (!linked) {
      return {
        error:
          "Quote was created, but we could not update the upload. Click again to retry.",
      };
    }

    revalidatePath("/admin");
    revalidatePath(`/admin/uploads/${uploadId}`);
    return redirect(`/admin/quotes/${newQuote.id}`);
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    console.error("createQuoteFromUpload: unexpected error", error);
    return { error: "Could not create quote, please try again." };
  }
}
