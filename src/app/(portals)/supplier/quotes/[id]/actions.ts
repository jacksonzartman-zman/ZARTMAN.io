"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabaseServer";
import { serializeSupabaseError, isMissingTableOrColumnError } from "@/server/admin/logging";
import { createSupplierQuoteMessage } from "@/server/quotes/messages";
import {
  getSupplierBidForQuote,
  loadSupplierProfile,
  loadSupplierProfileByUserId,
  getSupplierApprovalStatus,
  isSupplierApproved,
} from "@/server/suppliers";
import type { SupplierBidRow } from "@/server/suppliers";
import {
  SAFE_QUOTE_WITH_UPLOADS_FIELDS,
  type SafeQuoteWithUploadsField,
} from "@/server/suppliers/types";
import { loadBidForSupplierAndQuote } from "@/server/bids";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import { canUserBid } from "@/lib/permissions";
import type { QuoteWithUploadsRow } from "@/server/quotes/types";
import { getCurrentSession } from "@/server/auth";
import { approvalsEnabled } from "@/server/suppliers/flags";
import {
  getSupplierDisplayName,
  loadSupplierAssignments,
  matchesSupplierProcess,
  supplierHasAccess,
} from "./supplierAccess";

export type PostSupplierQuoteMessageState = {
  success: boolean;
  error: string | null;
  messageId?: string;
};

const GENERIC_ERROR =
  "Unable to send your message right now. Please try again.";

export type SupplierBidActionState =
  | { ok: true; message: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const BID_SUBMIT_ERROR = "We couldn't submit your bid. Please try again.";
const BID_ENV_DISABLED_ERROR = "Bids are not enabled in this environment yet.";
const BID_AMOUNT_INVALID_ERROR = "Enter a valid bid amount greater than 0.";

type QuoteAccessRow = Pick<QuoteWithUploadsRow, SafeQuoteWithUploadsField>;

export async function postSupplierQuoteMessageAction(
  _prevState: PostSupplierQuoteMessageState,
  formData: FormData,
): Promise<PostSupplierQuoteMessageState> {
  const rawQuoteId = formData.get("quote_id");
  const rawBody = formData.get("body");
  const rawEmail = formData.get("identity_email");

  if (typeof rawQuoteId !== "string" || rawQuoteId.trim().length === 0) {
    return { success: false, error: "Missing quote reference." };
  }

  if (typeof rawBody !== "string") {
    return { success: false, error: "Enter a message before sending." };
  }

  if (typeof rawEmail !== "string") {
    return { success: false, error: "Provide your email to continue." };
  }

  const quoteId = rawQuoteId.trim();
  const body = rawBody.trim();
  const identityEmail = normalizeEmailInput(rawEmail);

  if (!identityEmail) {
    return {
      success: false,
      error: "Provide a valid email address to continue.",
    };
  }

  if (body.length === 0) {
    return {
      success: false,
      error: "Enter a message before sending.",
    };
  }

  if (body.length > 2000) {
    return {
      success: false,
      error: "Message is too long. Keep it under 2,000 characters.",
    };
  }

  try {
    const [quoteResult, assignments, profile] = await Promise.all([
      loadQuoteAccessRow(quoteId),
      loadSupplierAssignments(quoteId),
      loadSupplierProfile(identityEmail),
    ]);

    const quote = quoteResult.data;
    const quoteError = quoteResult.error;

    if (quoteError) {
      console.error("Supplier post action: quote lookup failed", {
        quoteId,
        error: serializeSupabaseError(quoteError),
      });
      return { success: false, error: GENERIC_ERROR };
    }

    if (!quote) {
      return { success: false, error: "Quote not found." };
    }

    if (!profile?.supplier) {
      console.error("Supplier post action: no supplier profile", {
        quoteId,
        identityEmail,
      });
      return {
        success: false,
        error: "Complete onboarding before posting messages.",
      };
    }

    const uploadProcess = await loadUploadProcessHint(quote.upload_id ?? null);
    const verifiedProcessMatch = matchesSupplierProcess(
      profile.capabilities ?? [],
      uploadProcess,
    );

    if (
      !supplierHasAccess(identityEmail, quote, assignments, {
        supplier: profile.supplier,
        verifiedProcessMatch,
      })
    ) {
      console.error("Supplier post action: access denied", {
        quoteId,
        identityEmail,
        quoteEmail: quote.email,
        assignmentCount: assignments.length,
        reason: "ACCESS_DENIED",
      });
      return {
        success: false,
        error: "You do not have access to this quote.",
      };
    }

    const existingBid = await getSupplierBidForQuote(
      quoteId,
      profile.supplier.id,
    );

    if (existingBid?.status !== "accepted") {
      console.warn("Supplier post action: chat locked for supplier", {
        quoteId,
        identityEmail,
        supplierId: profile.supplier.id,
        bidStatus: existingBid?.status ?? "none",
        reason: "CHAT_LOCKED_UNACCEPTED_BID",
      });
      return {
        success: false,
        error: "Chat unlocks after your bid is accepted by the customer.",
      };
    }

    const supplierName = getSupplierDisplayName(
      identityEmail,
      quote,
      assignments,
    );

    const { data, error } = await createSupplierQuoteMessage({
      quoteId,
      body,
      authorName: supplierName,
      authorEmail: identityEmail,
    });

    if (error || !data) {
      console.error("Supplier post action: failed to create message", {
        quoteId,
        error,
      });
      return { success: false, error: GENERIC_ERROR };
    }

    revalidatePath(`/supplier/quotes/${quoteId}`);
    return { success: true, error: null, messageId: data.id };
  } catch (error) {
    console.error("Supplier post action: unexpected error", error);
    return { success: false, error: GENERIC_ERROR };
  }
}

export async function submitSupplierBidAction(
  _prevState: SupplierBidActionState,
  formData: FormData,
): Promise<SupplierBidActionState> {
  let quoteId: string | null = null;
  let supplierId: string | null = null;

  try {
    const session = await getCurrentSession();
    if (!session) {
      return {
        ok: false,
        error: "You need to be logged in to submit a bid.",
      };
    }

    quoteId = String(formData.get("quoteId") ?? "").trim();
    const amountInput = formData.get("amount");
    const currencyInput = String(formData.get("currency") ?? "USD").trim();
    const leadTimeInput = formData.get("leadTimeDays");
    const notesInput = formData.get("notes");

    const fieldErrors: Record<string, string> = {};

    if (!quoteId) {
      fieldErrors.quoteId = "Missing quote reference.";
    }

    const amount = parseSupplierBidAmount(amountInput);

    if (amount === null || amount <= 0) {
      fieldErrors.amount = BID_AMOUNT_INVALID_ERROR;
    }

    let leadTimeDays: number | null = null;
    if (typeof leadTimeInput === "string" && leadTimeInput.trim().length > 0) {
      const parsedLeadTime = Number(leadTimeInput);
      if (!Number.isFinite(parsedLeadTime) || parsedLeadTime < 0) {
        fieldErrors.leadTimeDays = "Lead time must be zero or more days.";
      } else {
        leadTimeDays = parsedLeadTime;
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      return {
        ok: false,
        error: "Fix the errors highlighted below.",
        fieldErrors,
      };
    }

    let supplierProfile =
      session.user.id ? await loadSupplierProfileByUserId(session.user.id) : null;

    if (!supplierProfile && session.user.email) {
      supplierProfile = await loadSupplierProfile(session.user.email);
    }

    if (!supplierProfile?.supplier) {
      return {
        ok: false,
        error: "Complete onboarding before submitting bids.",
      };
    }

    const supplier = supplierProfile.supplier;
    supplierId = supplier.id;
    const supplierEmail =
      normalizeEmailInput(
        supplier.primary_email ?? session.user.email ?? null,
      ) ?? null;

    if (!supplierEmail) {
      return {
        ok: false,
        error: "We couldn’t determine which supplier profile to use.",
      };
    }

    const approvalsOn = approvalsEnabled();
    const approvalStatus = getSupplierApprovalStatus(supplier);
    const approved = approvalsOn ? isSupplierApproved(supplier) : true;

    if (approvalsOn && !approved) {
      console.log("[bids] submit blocked: approvals pending", {
        supplierId: supplier.id,
        approvalStatus,
      });
      return {
        ok: false,
        error:
          "Your profile is pending review. You’ll be able to bid once you’re approved.",
      };
    }

    const quoteResult = await loadQuoteAccessRow(quoteId);
    const quote = quoteResult.data;
    const quoteError = quoteResult.error;

    if (quoteError) {
      const serialized = serializeSupabaseError(quoteError);
      if (isMissingTableOrColumnError(quoteError)) {
        console.warn("[bids] quote lookup missing schema", {
          quoteId,
          supplierId: supplier.id,
          error: serialized,
        });
        return {
          ok: false,
          error: BID_ENV_DISABLED_ERROR,
        };
      }

      console.error("[bids] quote lookup failed", {
        quoteId,
        supplierId: supplier.id,
        error: serialized,
      });
      return {
        ok: false,
        error: BID_SUBMIT_ERROR,
      };
    }

    if (!quote) {
      console.warn("[bids] quote not found", {
        quoteId,
        supplierId: supplier.id,
      });
      return {
        ok: false,
        error: "Quote not found.",
      };
    }

    const [assignments, uploadProcess] = await Promise.all([
      loadSupplierAssignments(quoteId),
      loadUploadProcessHint(quote.upload_id ?? null),
    ]);

    const verifiedProcessMatch = matchesSupplierProcess(
      supplierProfile.capabilities ?? [],
      uploadProcess,
    );

    if (
      !supplierHasAccess(supplierEmail, quote, assignments, {
        supplier,
        verifiedProcessMatch,
      })
    ) {
      console.error("Supplier bid action: access denied", {
        quoteId,
        supplierEmail,
        supplierId: supplier.id,
        reason: "ACCESS_DENIED",
      });
      return {
        ok: false,
        error: "You do not have access to this quote.",
      };
    }

    const bidResult = await loadBidForSupplierAndQuote(supplier.id, quoteId);
    if (!bidResult.ok) {
      return {
        ok: false,
        error: bidResult.error ?? BID_SUBMIT_ERROR,
      };
    }

    const existingBid = bidResult.data;
    const canBid = canUserBid("supplier", {
      status: quote.status,
      existingBidStatus: existingBid?.status ?? null,
      accessGranted: true,
    });

    if (!canBid) {
      return {
        ok: false,
        error:
          existingBid?.status === "accepted"
            ? "This bid is locked because it was already accepted."
            : "Bidding is closed for this quote.",
      };
    }

    const currency =
      currencyInput.length > 0 ? currencyInput.toUpperCase() : "USD";
    const notes =
      typeof notesInput === "string" && notesInput.trim().length > 0
        ? notesInput.trim()
        : null;

    const normalizedAmount = amount as number;

    try {
      const { data, error } = await supabaseServer
        .from("supplier_bids")
        .upsert(
          [
            {
              quote_id: quoteId,
              supplier_id: supplier.id,
              unit_price: normalizedAmount,
              currency,
              lead_time_days: leadTimeDays,
              notes,
              status: "submitted",
            },
          ],
          { onConflict: "quote_id,supplier_id" },
        )
        .select("id,status,updated_at")
        .maybeSingle<SupplierBidRow>();

      if (error) {
        const serialized = serializeSupabaseError(error);
        if (isMissingTableOrColumnError(error)) {
          console.warn("[bids] submit missing schema", {
            quoteId,
            supplierId: supplier.id,
            error: serialized,
          });
          return {
            ok: false,
            error: BID_ENV_DISABLED_ERROR,
          };
        }

        console.error("[bids] submit failed", {
          quoteId,
          supplierId: supplier.id,
          error: serialized,
        });
        return {
          ok: false,
          error: BID_SUBMIT_ERROR,
        };
      }

      console.log("[bids] submit success", {
        quoteId,
        supplierId: supplier.id,
        amount: normalizedAmount,
        currency,
        leadTimeDays,
        bidId: data?.id ?? null,
      });

      revalidatePath(`/supplier/quotes/${quoteId}`);
      revalidatePath("/supplier");
      revalidatePath("/admin");
      revalidatePath("/admin/quotes");
      revalidatePath(`/admin/quotes/${quoteId}`);
      revalidatePath(`/customer/quotes/${quoteId}`);

      return {
        ok: true,
        message: "Your bid has been submitted.",
      };
    } catch (error) {
      const serialized = serializeSupabaseError(error);
      if (isMissingTableOrColumnError(error)) {
        console.warn("[bids] submit missing schema", {
          quoteId,
          supplierId: supplier.id,
          error: serialized,
        });
        return {
          ok: false,
          error: BID_ENV_DISABLED_ERROR,
        };
      }
      console.error("[bids] submit crashed", {
        quoteId,
        supplierId: supplier.id,
        error: serialized ?? error,
      });
      return {
        ok: false,
        error: BID_SUBMIT_ERROR,
      };
    }
  } catch (error) {
    const serialized = serializeSupabaseError(error);
    console.error("[bids] submit crashed unexpectedly", {
      quoteId,
      supplierId,
      error: serialized ?? error,
    });
    return {
      ok: false,
      error: BID_SUBMIT_ERROR,
    };
  }
}

const QUOTE_ACCESS_SELECT = SAFE_QUOTE_WITH_UPLOADS_FIELDS.join(",");

async function loadQuoteAccessRow(quoteId: string) {
  return supabaseServer
    .from("quotes_with_uploads")
    .select(QUOTE_ACCESS_SELECT)
    .eq("id", quoteId)
    .maybeSingle<QuoteAccessRow>();
}

async function loadUploadProcessHint(
  uploadId: string | null,
): Promise<string | null> {
  if (!uploadId) {
    return null;
  }
  const { data, error } = await supabaseServer
    .from("uploads")
    .select("manufacturing_process")
    .eq("id", uploadId)
    .maybeSingle<{ manufacturing_process: string | null }>();

  if (error) {
    console.error("Supplier bid action: upload lookup failed", error);
    return null;
  }

  return data?.manufacturing_process ?? null;
}

function parseSupplierBidAmount(
  value: FormDataEntryValue | null,
): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/[,\s]/g, "");
  if (normalized.length === 0) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}
