import { supabaseServer } from "@/lib/supabaseServer";
import { classifyUploadFileType } from "@/lib/uploads/classifyFileType";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { schemaGate } from "@/server/db/schemaContract";

export type AdminQuotePartInput = {
  label: string;
  notes?: string | null;
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

function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const id = typeof item === "string" ? item.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export async function assertPartBelongsToQuote(args: {
  quoteId: string;
  quotePartId: string;
}): Promise<void> {
  const quoteId = typeof args.quoteId === "string" ? args.quoteId.trim() : "";
  const quotePartId =
    typeof args.quotePartId === "string" ? args.quotePartId.trim() : "";
  if (!quoteId || !quotePartId) {
    throw new Error("invalid_input");
  }

  const { data, error } = await supabaseServer
    .from("quote_parts")
    .select("id,quote_id")
    .eq("id", quotePartId)
    .maybeSingle<QuotePartRow>();

  if (error) {
    if (isMissingTableOrColumnError(error)) {
      throw new Error("parts_schema_missing");
    }
    console.error("[admin quote parts] failed to load quote part", {
      quoteId,
      quotePartId,
      error: serializeSupabaseError(error),
    });
    throw new Error("part_load_failed");
  }

  const partQuoteId = typeof data?.quote_id === "string" ? data.quote_id.trim() : "";
  if (!partQuoteId || partQuoteId !== quoteId) {
    throw new Error("part_quote_mismatch");
  }
}

export async function adminCreateQuotePart(
  quoteId: string,
  input: AdminQuotePartInput,
): Promise<void> {
  const normalizedQuoteId = typeof quoteId === "string" ? quoteId.trim() : "";
  const label =
    typeof input?.label === "string" ? input.label.trim() : "";
  const notes =
    typeof input?.notes === "string"
      ? input.notes.trim()
      : input?.notes === null
        ? null
        : null;

  if (!normalizedQuoteId || !label) {
    throw new Error("invalid_input");
  }

  const { error } = await supabaseServer.from("quote_parts").insert({
    quote_id: normalizedQuoteId,
    part_label: label,
    notes,
  });

  if (error) {
    if (isMissingTableOrColumnError(error)) {
      throw new Error("parts_schema_missing");
    }
    console.error("[admin quote parts] create part failed", {
      quoteId: normalizedQuoteId,
      error: serializeSupabaseError(error),
    });
    throw new Error("part_create_failed");
  }
}

export async function adminUpdateQuotePartFiles(args: {
  quoteId: string;
  quotePartId: string;
  addFileIds?: string[];
  removeFileIds?: string[];
  role?: string | null;
}): Promise<void> {
  const quoteId = typeof args.quoteId === "string" ? args.quoteId.trim() : "";
  const quotePartId =
    typeof args.quotePartId === "string" ? args.quotePartId.trim() : "";
  const addFileIds = normalizeIdList(args.addFileIds);
  const removeFileIds = normalizeIdList(args.removeFileIds);
  const roleRaw = typeof args.role === "string" ? args.role.trim().toLowerCase() : null;
  const role =
    roleRaw === "cad" || roleRaw === "drawing" || roleRaw === "other" ? roleRaw : null;

  if (!quoteId || !quotePartId) {
    throw new Error("invalid_input");
  }

  await assertPartBelongsToQuote({ quoteId, quotePartId });

  if (addFileIds.length > 0) {
    const hasUploadsSchema = await schemaGate({
      enabled: true,
      relation: "quote_upload_files",
      requiredColumns: ["id", "quote_id", "filename", "extension"],
      warnPrefix: "[quote_upload_files]",
    });
    if (!hasUploadsSchema) {
      // Optional feature: if upload-file metadata isn't present, skip linking.
      return;
    }

    let uploadFiles: QuoteUploadFileRow[] = [];
    try {
      const { data, error } = await supabaseServer
        .from("quote_upload_files")
        .select("id,filename,extension")
        .in("id", addFileIds)
        .eq("quote_id", quoteId)
        .returns<QuoteUploadFileRow[]>();

      if (error) {
        if (!isMissingTableOrColumnError(error)) {
          console.error("[admin quote parts] load upload files failed", {
            quoteId,
            quotePartId,
            error: serializeSupabaseError(error),
          });
        }
      } else {
        uploadFiles = Array.isArray(data) ? data : [];
      }
    } catch (error) {
      if (!isMissingTableOrColumnError(error)) {
        console.error("[admin quote parts] load upload files crashed", {
          quoteId,
          quotePartId,
          error,
        });
      }
    }

    const inferredRoleByFileId = new Map<string, "cad" | "drawing" | "other">();
    if (!role) {
      for (const row of uploadFiles) {
        const id = typeof row?.id === "string" ? row.id.trim() : "";
        if (!id) continue;
        const kind = classifyUploadFileType({
          filename: row.filename,
          extension: row.extension ?? null,
        });
        inferredRoleByFileId.set(id, kind);
      }
    }

    const rows = addFileIds.map((fileId) => ({
      quote_part_id: quotePartId,
      quote_upload_file_id: fileId,
      role: role ?? inferredRoleByFileId.get(fileId) ?? "other",
    }));

    const { error } = await supabaseServer
      .from("quote_part_files")
      .upsert(rows, {
        onConflict: "quote_part_id,quote_upload_file_id",
        ignoreDuplicates: true,
      });

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        throw new Error("part_files_schema_missing");
      }
      console.error("[admin quote parts] upsert part files failed", {
        quoteId,
        quotePartId,
        error: serializeSupabaseError(error),
      });
      throw new Error("part_files_upsert_failed");
    }
  }

  if (removeFileIds.length > 0) {
    const { error } = await supabaseServer
      .from("quote_part_files")
      .delete()
      .eq("quote_part_id", quotePartId)
      .in("quote_upload_file_id", removeFileIds);

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        throw new Error("part_files_schema_missing");
      }
      console.error("[admin quote parts] delete part files failed", {
        quoteId,
        quotePartId,
        error: serializeSupabaseError(error),
      });
      throw new Error("part_files_delete_failed");
    }
  }
}

