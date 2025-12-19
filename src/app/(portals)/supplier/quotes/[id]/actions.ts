"use server";

import { revalidatePath } from "next/cache";
import {
  submitSupplierBidImpl,
  postSupplierMessageImpl,
  completeKickoffTaskImpl,
  type SupplierBidFormState,
  type SupplierKickoffFormState,
  type ToggleSupplierKickoffTaskInput,
} from "@/server/quotes/supplierQuoteServer";
import type { QuoteMessageFormState } from "@/app/(portals)/components/QuoteMessagesThread.types";
import { createAuthClient, getServerAuthUser } from "@/server/auth";
import { loadSupplierProfileByUserId } from "@/server/suppliers";
import { assertSupplierQuoteAccess } from "@/server/quotes/access";
import type { SupplierFeedbackCategory } from "@/server/quotes/rfqQualitySignals";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import {
  buildUploadTargetForQuote,
  isAllowedQuoteUploadFileName,
  registerUploadedObjectsForQuote,
  type UploadTarget,
} from "@/server/quotes/uploadFiles";
import { MAX_UPLOAD_BYTES } from "@/lib/uploads/uploadLimits";
import {
  upsertSupplierBidDraft,
  type SupplierBidDraft,
} from "@/server/suppliers/bidLines";

export type {
  SupplierBidFormState,
  SupplierKickoffFormState,
};
export type { QuoteMessageFormState } from "@/app/(portals)/components/QuoteMessagesThread.types";

export async function submitSupplierBid(
  _prevState: SupplierBidFormState,
  formData: FormData,
): Promise<SupplierBidFormState> {
  return submitSupplierBidImpl(formData);
}

export async function submitSupplierBidFromWorkspace(args: {
  quoteId: string;
  amount: number;
  leadTimeDays: number;
  notes?: string | null;
}): Promise<SupplierBidFormState> {
  const quoteId = typeof args?.quoteId === "string" ? args.quoteId.trim() : "";
  const amount = typeof args?.amount === "number" ? args.amount : Number.NaN;
  const leadTimeDays =
    typeof args?.leadTimeDays === "number" ? args.leadTimeDays : Number.NaN;
  const notes =
    args?.notes === null
      ? null
      : typeof args?.notes === "string"
        ? args.notes
        : null;

  const formData = new FormData();
  formData.set("quoteId", quoteId);
  formData.set("amount", Number.isFinite(amount) ? String(amount) : "");
  formData.set("currency", "USD");
  formData.set(
    "leadTimeDays",
    Number.isFinite(leadTimeDays) ? String(Math.round(leadTimeDays)) : "",
  );
  if (notes) {
    formData.set("notes", notes);
  }

  return submitSupplierBidImpl(formData);
}

export async function postQuoteMessage(
  quoteId: string,
  _prevState: QuoteMessageFormState,
  formData: FormData,
): Promise<QuoteMessageFormState> {
  return postSupplierMessageImpl(quoteId, formData);
}

export async function completeKickoffTask(
  input: ToggleSupplierKickoffTaskInput,
): Promise<SupplierKickoffFormState> {
  return completeKickoffTaskImpl(input);
}

export type SupplierDeclineFeedbackFormState =
  | { ok: true; message: string }
  | { ok: false; error: string };

const SUPPLIER_FEEDBACK_CATEGORIES = new Set<SupplierFeedbackCategory>([
  "scope_unclear",
  "missing_drawings",
  "missing_cad",
  "timeline_unrealistic",
  "materials_unclear",
  "pricing_risk",
  "outside_capability",
  "other",
]);

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export type SaveSupplierBidDraftResult =
  | { ok: true }
  | { ok: false; error: string };

export async function saveSupplierBidDraftAction(
  quoteId: string,
  draft: SupplierBidDraft,
): Promise<SaveSupplierBidDraftResult> {
  const normalizedQuoteId = normalizeText(quoteId);
  if (!normalizedQuoteId) {
    return { ok: false, error: "Missing quote ID." };
  }

  const { user } = await getServerAuthUser();
  if (!user?.id) {
    return { ok: false, error: "You must be signed in to save drafts." };
  }

  const profile = await loadSupplierProfileByUserId(user.id);
  const supplierId = profile?.supplier?.id ?? null;
  if (!supplierId) {
    return { ok: false, error: "Supplier profile not found." };
  }

  const access = await assertSupplierQuoteAccess({
    quoteId: normalizedQuoteId,
    supplierId,
    supplierUserEmail: user.email ?? null,
  });
  if (!access.ok) {
    return { ok: false, error: "Not invited to this RFQ." };
  }

  try {
    await upsertSupplierBidDraft(normalizedQuoteId, supplierId, draft);
    revalidatePath(`/supplier/quotes/${normalizedQuoteId}`);
    return { ok: true };
  } catch (error) {
    console.error("[supplier bid draft] save crashed", {
      quoteId: normalizedQuoteId,
      supplierId,
      error: serializeSupabaseError(error),
    });
    return { ok: false, error: "Could not save draft. Please try again." };
  }
}

export type SupplierUploadsFormState =
  | { status: "idle" }
  | { status: "success"; message?: string }
  | { status: "error"; message?: string };

export type SupplierUploadTarget = {
  storagePath: string;
  bucketId: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
};

type SupplierFileMeta = {
  fileName: string;
  sizeBytes: number;
  mimeType: string | null;
};

function parseFilesMeta(formData: FormData): SupplierFileMeta[] {
  const json = formData.get("filesMeta");
  if (typeof json !== "string" || json.trim().length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const fileName =
          "fileName" in row && typeof (row as any).fileName === "string"
            ? (row as any).fileName
            : "";
        const sizeBytes =
          "sizeBytes" in row && typeof (row as any).sizeBytes === "number"
            ? (row as any).sizeBytes
            : Number.NaN;
        const mimeType =
          "mimeType" in row && typeof (row as any).mimeType === "string"
            ? ((row as any).mimeType as string)
            : null;
        const trimmed = String(fileName).trim();
        if (!trimmed) return null;
        if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return null;
        return { fileName: trimmed, sizeBytes, mimeType };
      })
      .filter((v): v is SupplierFileMeta => Boolean(v));
  } catch {
    return [];
  }
}

export async function getUploadTargetsForSupplierQuote(
  quoteId: string,
  _prevState: SupplierUploadsFormState,
  formData: FormData,
): Promise<
  | { status: "success"; targets: SupplierUploadTarget[] }
  | SupplierUploadsFormState
> {
  const normalizedQuoteId = normalizeText(quoteId);
  if (!normalizedQuoteId) {
    return { status: "error", message: "Missing quote reference." };
  }

  const { user, error } = await getServerAuthUser();
  if (error || !user?.id) {
    return { status: "error", message: "You must be signed in to upload files." };
  }

  const profile = await loadSupplierProfileByUserId(user.id);
  const supplierId = profile?.supplier?.id ?? null;
  if (!supplierId) {
    return { status: "error", message: "Supplier profile not found." };
  }

  const access = await assertSupplierQuoteAccess({
    quoteId: normalizedQuoteId,
    supplierId,
    supplierUserEmail: user.email ?? null,
  });
  if (!access.ok) {
    return { status: "error", message: "Not invited to this RFQ." };
  }

  const filesMeta = parseFilesMeta(formData);
  if (filesMeta.length === 0) {
    return { status: "error", message: "No files selected." };
  }

  const tooLarge = filesMeta.filter((f) => f.sizeBytes > MAX_UPLOAD_BYTES);
  if (tooLarge.length > 0) {
    return { status: "error", message: "One or more files exceed the size limit." };
  }

  const unsupported = filesMeta.filter((f) => !isAllowedQuoteUploadFileName(f.fileName));
  if (unsupported.length > 0) {
    return { status: "error", message: "One or more files are not a supported type." };
  }

  const targets = filesMeta.map((file) =>
    buildUploadTargetForQuote({
      quoteId: normalizedQuoteId,
      fileName: file.fileName,
      sizeBytes: file.sizeBytes,
      mimeType: file.mimeType,
    }),
  );

  return {
    status: "success",
    targets: targets.map((t) => ({
      storagePath: t.storagePath,
      bucketId: t.bucketId,
      fileName: t.originalFileName,
      mimeType: t.mimeType,
      sizeBytes: t.sizeBytes,
    })),
  };
}

export async function registerUploadedFilesForSupplierQuote(
  quoteId: string,
  _prevState: SupplierUploadsFormState,
  formData: FormData,
): Promise<SupplierUploadsFormState> {
  const normalizedQuoteId = normalizeText(quoteId);
  if (!normalizedQuoteId) {
    return { status: "error", message: "Missing quote reference." };
  }

  const { user, error } = await getServerAuthUser();
  if (error || !user?.id) {
    return { status: "error", message: "You must be signed in to upload files." };
  }

  const profile = await loadSupplierProfileByUserId(user.id);
  const supplierId = profile?.supplier?.id ?? null;
  if (!supplierId) {
    return { status: "error", message: "Supplier profile not found." };
  }

  const access = await assertSupplierQuoteAccess({
    quoteId: normalizedQuoteId,
    supplierId,
    supplierUserEmail: user.email ?? null,
  });
  if (!access.ok) {
    return { status: "error", message: "Not invited to this RFQ." };
  }

  try {
    const json = formData.get("targets");
    if (typeof json !== "string" || json.trim().length === 0) {
      return { status: "error", message: "Missing upload targets." };
    }

    const parsed = JSON.parse(json) as SupplierUploadTarget[];
    const targets: UploadTarget[] = Array.isArray(parsed)
      ? parsed.map((t) => ({
          storagePath: t.storagePath,
          bucketId: t.bucketId,
          originalFileName: t.fileName,
          mimeType: t.mimeType,
          sizeBytes: t.sizeBytes,
        }))
      : [];

    if (targets.length === 0) {
      return { status: "error", message: "Missing upload targets." };
    }

    await registerUploadedObjectsForQuote({
      quoteId: normalizedQuoteId,
      targets,
    });

    revalidatePath(`/supplier/quotes/${normalizedQuoteId}`);
    revalidatePath(`/admin/quotes/${normalizedQuoteId}`);
    revalidatePath(`/customer/quotes/${normalizedQuoteId}`);
    return { status: "success", message: "Files uploaded." };
  } catch (e) {
    console.error("[supplier uploads] register failed", {
      quoteId: normalizedQuoteId,
      supplierId,
      error: serializeSupabaseError(e),
    });
    return { status: "error", message: "We could not register these files. Please try again." };
  }
}

export async function supplierDeclineRfqWithFeedbackAction(
  quoteId: string,
  _prevState: SupplierDeclineFeedbackFormState,
  formData: FormData,
): Promise<SupplierDeclineFeedbackFormState> {
  const normalizedQuoteId = normalizeText(quoteId);
  if (!normalizedQuoteId) {
    return { ok: false, error: "Missing quote ID." };
  }

  const { user } = await getServerAuthUser();
  if (!user?.id) {
    return { ok: false, error: "You must be signed in to submit feedback." };
  }

  const profile = await loadSupplierProfileByUserId(user.id);
  const supplierId = profile?.supplier?.id ?? null;
  if (!supplierId) {
    return { ok: false, error: "Supplier profile not found." };
  }

  const access = await assertSupplierQuoteAccess({
    quoteId: normalizedQuoteId,
    supplierId,
    supplierUserEmail: user.email ?? null,
  });
  if (!access.ok) {
    return { ok: false, error: "Not invited to this RFQ." };
  }

  const rawCategories = formData.getAll("categories");
  const categories = Array.from(
    new Set(
      rawCategories
        .map((value) => normalizeText(value))
        .filter((value): value is SupplierFeedbackCategory =>
          SUPPLIER_FEEDBACK_CATEGORIES.has(value as SupplierFeedbackCategory),
        ),
    ),
  );
  const noteRaw = normalizeText(formData.get("note"));
  const note = noteRaw ? noteRaw.slice(0, 1000) : "";

  console.log("[rfq feedback] supplier declined with", {
    quoteId: normalizedQuoteId,
    supplierId,
    supplierUserId: user.id,
    categories,
    note,
  });

  try {
    const supabase = createAuthClient();
    const { error } = await supabase.from("quote_rfq_feedback").insert({
      quote_id: normalizedQuoteId,
      supplier_id: supplierId,
      categories,
      note: note || null,
    });

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        console.warn("[rfq feedback] schema missing; skipping persist", {
          quoteId: normalizedQuoteId,
          supplierId,
          error: serializeSupabaseError(error) ?? error,
        });
      } else {
        console.error("[rfq feedback] insert failed", {
          quoteId: normalizedQuoteId,
          supplierId,
          error: serializeSupabaseError(error) ?? error,
        });
      }
    }
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      console.warn("[rfq feedback] schema missing; skipping persist", {
        quoteId: normalizedQuoteId,
        supplierId,
        error: serializeSupabaseError(error) ?? error,
      });
    } else {
      console.error("[rfq feedback] insert crashed", {
        quoteId: normalizedQuoteId,
        supplierId,
        error: serializeSupabaseError(error) ?? error,
      });
    }
  }

  revalidatePath("/supplier/rfqs");
  revalidatePath("/supplier/quotes");

  return { ok: true, message: "Thanks — feedback sent." };
}
