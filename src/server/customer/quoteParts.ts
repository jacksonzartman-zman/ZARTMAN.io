import { supabaseServer } from "@/lib/supabaseServer";
import { classifyUploadFileType } from "@/lib/uploads/classifyFileType";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import { createAuthClient } from "@/server/auth";
import { getCustomerByEmail, getCustomerByUserId } from "@/server/customers";
import { serializeSupabaseError } from "@/server/admin/logging";
import { schemaGate } from "@/server/db/schemaContract";

export type CustomerQuotePartInput = {
  label: string;
  notes?: string | null;
};

type QuoteGuardRow = {
  id: string;
  customer_id: string | null;
  customer_email: string | null;
};

type QuotePartRow = {
  id: string;
  quote_id: string;
};

type QuoteUploadFileRow = {
  id: string;
  filename: string;
  extension: string | null;
};

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const id = normalizeId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

async function assertCustomerCanAccessQuote(args: {
  quoteId: string;
  userId: string;
  email: string | null;
}): Promise<{
  quoteId: string;
  customerId: string | null;
  customerEmail: string | null;
}> {
  const quoteId = normalizeId(args.quoteId);
  const userId = normalizeId(args.userId);
  const userEmail = normalizeEmailInput(args.email ?? null);

  if (!quoteId || !userId) {
    throw new Error("invalid_input");
  }

  const customer = await getCustomerByUserId(userId);
  const customerFallback = !customer && userEmail ? await getCustomerByEmail(userEmail) : null;
  const customerId = normalizeId(customer?.id ?? customerFallback?.id ?? null) || null;
  const customerEmail = normalizeEmailInput(customer?.email ?? customerFallback?.email ?? userEmail);

  if (!customerEmail && !customerId) {
    throw new Error("access_denied");
  }

  const { data: quoteRow, error: quoteError } = await supabaseServer()
    .from("quotes")
    .select("id,customer_id,customer_email")
    .eq("id", quoteId)
    .maybeSingle<QuoteGuardRow>();

  if (quoteError) {
    console.error("[customer parts] quote lookup failed", {
      quoteId,
      userId,
      error: serializeSupabaseError(quoteError),
    });
    throw new Error("quote_lookup_failed");
  }

  if (!quoteRow?.id) {
    throw new Error("quote_not_found");
  }

  const quoteCustomerId = normalizeId(quoteRow.customer_id);
  const quoteCustomerEmail = normalizeEmailInput(quoteRow.customer_email ?? null);
  const customerIdMatches =
    Boolean(customerId) && Boolean(quoteCustomerId) && customerId === quoteCustomerId;
  const customerEmailMatches =
    Boolean(customerEmail) &&
    Boolean(quoteCustomerEmail) &&
    customerEmail === quoteCustomerEmail;
  const userEmailMatches =
    Boolean(userEmail) && Boolean(quoteCustomerEmail) && userEmail === quoteCustomerEmail;

  if (!customerIdMatches && !customerEmailMatches && !userEmailMatches) {
    console.warn("[customer parts] access denied", {
      quoteId,
      userId,
      customerId,
      customerEmail,
      userEmail,
    });
    throw new Error("access_denied");
  }

  return { quoteId, customerId, customerEmail };
}

export async function customerCreateQuotePart(
  quoteId: string,
  input: CustomerQuotePartInput,
  customerUserIdOrEmail: { userId: string; email: string | null },
): Promise<void> {
  const normalizedQuoteId = normalizeId(quoteId);
  const label = typeof input?.label === "string" ? input.label.trim() : "";
  const notes =
    typeof input?.notes === "string"
      ? input.notes.trim()
      : input?.notes === null
        ? null
        : null;

  if (!normalizedQuoteId || !label) {
    throw new Error("invalid_input");
  }

  await assertCustomerCanAccessQuote({
    quoteId: normalizedQuoteId,
    userId: customerUserIdOrEmail.userId,
    email: customerUserIdOrEmail.email ?? null,
  });

  const supabase = createAuthClient();
  const { error } = await supabase.from("quote_parts").insert({
    quote_id: normalizedQuoteId,
    part_label: label,
    notes,
  });

  if (error) {
    console.error("[customer parts] create part failed", {
      quoteId: normalizedQuoteId,
      error: serializeSupabaseError(error),
    });
    throw new Error("part_create_failed");
  }
}

export async function customerUpdateQuotePartFiles(args: {
  quoteId: string;
  quotePartId: string;
  addFileIds?: string[];
  removeFileIds?: string[];
}): Promise<void> {
  const quoteId = normalizeId(args.quoteId);
  const quotePartId = normalizeId(args.quotePartId);
  const addFileIds = normalizeIdList(args.addFileIds);
  const removeFileIds = normalizeIdList(args.removeFileIds);

  if (!quoteId || !quotePartId) {
    throw new Error("invalid_input");
  }

  const supabase = createAuthClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData?.user ?? null;
  if (authError || !user) {
    console.warn("[customer parts] missing auth user for update", {
      quoteId,
      quotePartId,
      error: serializeSupabaseError(authError),
    });
    throw new Error("access_denied");
  }

  await assertCustomerCanAccessQuote({
    quoteId,
    userId: user.id,
    email: user.email ?? null,
  });

  // Validate part belongs to quote (via RLS-protected read).
  const { data: partRow, error: partError } = await supabase
    .from("quote_parts")
    .select("id,quote_id")
    .eq("id", quotePartId)
    .maybeSingle<QuotePartRow>();

  if (partError) {
    console.error("[customer parts] load quote part failed", {
      quoteId,
      quotePartId,
      error: serializeSupabaseError(partError),
    });
    throw new Error("part_load_failed");
  }

  const partQuoteId = normalizeId(partRow?.quote_id);
  if (!partQuoteId || partQuoteId !== quoteId) {
    throw new Error("part_quote_mismatch");
  }

  // Only allow touches on files belonging to this quote.
  const touchedFileIds = Array.from(new Set([...addFileIds, ...removeFileIds]));
  const allowedFileIds = new Set<string>();
  const uploadFilesById = new Map<string, QuoteUploadFileRow>();

  if (touchedFileIds.length > 0) {
    const hasUploadsSchema = await schemaGate({
      enabled: true,
      relation: "quote_upload_files",
      requiredColumns: ["id", "quote_id", "filename", "extension"],
      warnPrefix: "[quote_upload_files]",
    });
    if (!hasUploadsSchema) {
      // Optional feature: if upload-file metadata isn't present in this env, skip linking.
      return;
    }

    const { data: uploadFiles, error: uploadFilesError } = await supabase
      .from("quote_upload_files")
      .select("id,filename,extension")
      .in("id", touchedFileIds)
      .eq("quote_id", quoteId)
      .returns<QuoteUploadFileRow[]>();

    if (uploadFilesError) {
      console.error("[customer parts] load upload files failed", {
        quoteId,
        quotePartId,
        error: serializeSupabaseError(uploadFilesError),
      });
      throw new Error("upload_files_load_failed");
    }

    for (const row of uploadFiles ?? []) {
      const id = normalizeId(row?.id);
      if (!id) continue;
      allowedFileIds.add(id);
      uploadFilesById.set(id, row);
    }
  }

  const safeAddFileIds = addFileIds.filter((id) => allowedFileIds.has(id));
  const safeRemoveFileIds = removeFileIds.filter((id) => allowedFileIds.has(id));

  if (safeAddFileIds.length > 0) {
    const inferredRoleByFileId = new Map<string, "cad" | "drawing" | "other">();
    for (const fileId of safeAddFileIds) {
      const row = uploadFilesById.get(fileId);
      if (!row) continue;
      const kind = classifyUploadFileType({
        filename: row.filename,
        extension: row.extension ?? null,
      });
      inferredRoleByFileId.set(fileId, kind);
    }

    const rows = safeAddFileIds.map((fileId) => ({
      quote_part_id: quotePartId,
      quote_upload_file_id: fileId,
      role: inferredRoleByFileId.get(fileId) ?? "other",
    }));

    const { error } = await supabase.from("quote_part_files").upsert(rows, {
      onConflict: "quote_part_id,quote_upload_file_id",
      ignoreDuplicates: true,
    });

    if (error) {
      console.error("[customer parts] upsert part files failed", {
        quoteId,
        quotePartId,
        error: serializeSupabaseError(error),
      });
      throw new Error("part_files_upsert_failed");
    }
  }

  if (safeRemoveFileIds.length > 0) {
    const { error } = await supabase
      .from("quote_part_files")
      .delete()
      .eq("quote_part_id", quotePartId)
      .in("quote_upload_file_id", safeRemoveFileIds);

    if (error) {
      console.error("[customer parts] delete part files failed", {
        quoteId,
        quotePartId,
        error: serializeSupabaseError(error),
      });
      throw new Error("part_files_delete_failed");
    }
  }
}

