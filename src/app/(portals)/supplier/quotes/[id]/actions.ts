"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabaseServer";
import { serializeSupabaseError, isMissingTableOrColumnError } from "@/server/admin/logging";
import { createQuoteMessage } from "@/server/quotes/messages";
import {
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
import { getServerAuthUser, requireUser } from "@/server/auth";
import { approvalsEnabled } from "@/server/suppliers/flags";
import {
  getSupplierDisplayName,
  loadSupplierAssignments,
  matchesSupplierProcess,
  supplierHasAccess,
} from "./supplierAccess";

export type SupplierMessageFormState = {
  ok: boolean;
  message?: string | null;
  error?: string | null;
  fieldErrors?: {
    body?: string;
  };
};

const SUPPLIER_MESSAGE_PROFILE_ERROR =
  "We couldn’t find your supplier profile.";
const SUPPLIER_MESSAGE_GENERIC_ERROR =
  "We couldn’t send your message. Please try again.";
const SUPPLIER_MESSAGE_ACCESS_ERROR =
  "Chat is only available after your bid is selected for this RFQ.";
const SUPPLIER_MESSAGE_LOCKED_ERROR =
  "Chat unlocks after your bid is accepted for this RFQ.";

export async function submitSupplierQuoteMessageAction(
  quoteId: string,
  _prevState: SupplierMessageFormState,
  formData: FormData,
): Promise<SupplierMessageFormState> {
  const trimmedQuoteId = typeof quoteId === "string" ? quoteId.trim() : "";
  const bodyValue = formData.get("body");
  const body =
    typeof bodyValue === "string"
      ? bodyValue.trim()
      : String(bodyValue ?? "").trim();

  if (!trimmedQuoteId) {
    return {
      ok: false,
      error: "Missing quote ID.",
      fieldErrors: {},
    };
  }

  if (body.length === 0) {
    return {
      ok: false,
      error: "Message can’t be empty.",
      fieldErrors: { body: "Please enter a message before sending." },
    };
  }

  if (body.length > 2000) {
    return {
      ok: false,
      error: "Message is too long.",
      fieldErrors: {
        body: "Keep messages under 2,000 characters.",
      },
    };
  }

  try {
    const user = await requireUser({
      redirectTo: `/supplier/quotes/${trimmedQuoteId}`,
      message: "Sign in to post a message.",
    });

    let profile = user.id
      ? await loadSupplierProfileByUserId(user.id)
      : null;

    if (!profile && user.email) {
      profile = await loadSupplierProfile(user.email);
    }

    if (!profile?.supplier?.id) {
      console.error("[supplier messages] no supplier profile for user", {
        quoteId: trimmedQuoteId,
        userId: user.id,
        email: user.email ?? null,
      });
      return {
        ok: false,
        error: SUPPLIER_MESSAGE_PROFILE_ERROR,
        fieldErrors: {},
      };
    }

    const supplierId = profile.supplier.id;
    const bidResult = await loadBidForSupplierAndQuote(
      supplierId,
      trimmedQuoteId,
    );

    if (!bidResult.ok || !bidResult.data) {
      console.error("[supplier messages] access denied – no bid", {
        quoteId: trimmedQuoteId,
        supplierId,
        error: bidResult.error,
      });
      return {
        ok: false,
        error: SUPPLIER_MESSAGE_ACCESS_ERROR,
        fieldErrors: {},
      };
    }

    const bid = bidResult.data;
    const status = (bid?.status ?? "").toLowerCase();
    const messagingUnlocked =
      status === "accepted" || status === "won" || status === "winner";

    if (!messagingUnlocked) {
      console.error("[supplier messages] access denied – bid not accepted", {
        quoteId: trimmedQuoteId,
        supplierId,
        status,
      });
      return {
        ok: false,
        error: SUPPLIER_MESSAGE_LOCKED_ERROR,
        fieldErrors: {},
      };
    }

    const authorName =
      profile.supplier.company_name ??
      user.email ??
      "Supplier";

    const authorEmail =
      profile.supplier.primary_email ??
      user.email ??
      "supplier@zartman.io";

    console.log("[supplier messages] create start", {
      quoteId: trimmedQuoteId,
      supplierId,
    });

    const result = await createQuoteMessage({
      quoteId: trimmedQuoteId,
      body,
      authorType: "supplier",
      authorName,
      authorEmail,
    });

    if (!result.ok || !result.data) {
      console.error("[supplier messages] create failed", {
        quoteId: trimmedQuoteId,
        supplierId,
        error: result.error,
      });

      return {
        ok: false,
        error: result.error ?? SUPPLIER_MESSAGE_GENERIC_ERROR,
        fieldErrors: {},
      };
    }

    console.log("[supplier messages] create success", {
      quoteId: trimmedQuoteId,
      supplierId,
      messageId: result.data.id,
    });

    revalidatePath(`/supplier/quotes/${trimmedQuoteId}`);
    revalidatePath(`/customer/quotes/${trimmedQuoteId}`);
    revalidatePath(`/admin/quotes/${trimmedQuoteId}`);

    return {
      ok: true,
      message: "Message sent.",
      error: "",
      fieldErrors: {},
    };
  } catch (error) {
    console.error("[supplier messages] action crashed", {
      quoteId: trimmedQuoteId,
      error,
    });
    return {
      ok: false,
      error: "Unexpected error while sending your message.",
      fieldErrors: {},
    };
  }
}

export type SupplierBidActionState =
  | { ok: true; message: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const BID_SUBMIT_ERROR = "We couldn't submit your bid. Please try again.";
const BID_ENV_DISABLED_ERROR = "Bids are not enabled in this environment yet.";
const BID_AMOUNT_INVALID_ERROR = "Enter a valid bid amount greater than 0.";
const SUPPLIER_BIDS_MISSING_SCHEMA_MESSAGE =
  "Bids are not available in this environment.";

type QuoteAccessRow = Pick<QuoteWithUploadsRow, SafeQuoteWithUploadsField>;


export async function submitSupplierBidAction(
  _prevState: SupplierBidActionState,
  formData: FormData,
): Promise<SupplierBidActionState> {
  let quoteId: string | null = null;
  let supplierId: string | null = null;

  console.log("[bids] submit action invoked");

  try {
    const { user } = await getServerAuthUser();
    if (!user) {
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
    const leadTimeParse = parseLeadTimeDays(leadTimeInput);
    if (!leadTimeParse.ok) {
      fieldErrors.leadTimeDays = leadTimeParse.error;
    } else {
      leadTimeDays = leadTimeParse.value;
    }

    console.log("[bids] submit parsed fields", {
      quoteId,
      supplierId,
      amountInput,
      normalizedAmount: amount,
      currency: currencyInput,
      leadTimeDays,
    });

    if (Object.keys(fieldErrors).length > 0) {
      logBidSubmitFailure({
        quoteId,
        supplierId,
        reason: "validation-error",
        phase: "input-validation",
        details: fieldErrors,
      });
      const amountError = fieldErrors.amount
        ? BID_AMOUNT_INVALID_ERROR
        : "Fix the errors highlighted below.";
      return {
        ok: false,
        error: amountError,
        fieldErrors,
      };
    }

    let supplierProfile = user.id ? await loadSupplierProfileByUserId(user.id) : null;

    if (!supplierProfile && user.email) {
      supplierProfile = await loadSupplierProfile(user.email);
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
        supplier.primary_email ?? user.email ?? null,
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
        logBidSubmitFailure({
          quoteId,
          supplierId: supplier.id,
          reason: "env-disabled",
          phase: "quote-lookup",
          supabaseError: serialized,
        });
        return {
          ok: false,
          error: BID_ENV_DISABLED_ERROR,
        };
      }

      logBidSubmitFailure({
        quoteId,
        supplierId: supplier.id,
        reason: "supabase-error",
        phase: "quote-lookup",
        supabaseError: serialized,
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
      if (isBidsEnvErrorMessage(bidResult.error)) {
        logBidSubmitFailure({
          quoteId,
          supplierId: supplier.id,
          reason: "env-disabled",
          phase: "bid-lookup",
          supabaseError: bidResult.error,
        });
        return {
          ok: false,
          error: BID_ENV_DISABLED_ERROR,
        };
      }
      logBidSubmitFailure({
        quoteId,
        supplierId: supplier.id,
        reason: "bid-loader-error",
        phase: "bid-lookup",
        supabaseError: bidResult.error,
      });
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
          logBidSubmitFailure({
            quoteId,
            supplierId: supplier.id,
            reason: "env-disabled",
            phase: "bid-upsert",
            supabaseError: serialized,
          });
          return {
            ok: false,
            error: BID_ENV_DISABLED_ERROR,
          };
        }

        logBidSubmitFailure({
          quoteId,
          supplierId: supplier.id,
          reason: "supabase-error",
          phase: "bid-upsert",
          supabaseError: serialized,
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
        logBidSubmitFailure({
          quoteId,
          supplierId: supplier.id,
          reason: "env-disabled",
          phase: "bid-upsert",
          supabaseError: serialized,
        });
        return {
          ok: false,
          error: BID_ENV_DISABLED_ERROR,
        };
      }
      logBidSubmitFailure({
        quoteId,
        supplierId: supplier.id,
        reason: "unexpected-error",
        phase: "bid-upsert",
        supabaseError: serialized ?? error,
      });
      return {
        ok: false,
        error: BID_SUBMIT_ERROR,
      };
    }
  } catch (error) {
    const serialized = serializeSupabaseError(error);
    logBidSubmitFailure({
      quoteId,
      supplierId,
      reason: "unexpected-error",
      phase: "action-crash",
      supabaseError: serialized ?? error,
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

function logBidSubmitFailure(args: {
  quoteId: string | null;
  supplierId: string | null;
  reason: string;
  phase?: string;
  supabaseError?: unknown;
  details?: unknown;
}) {
  const { quoteId, supplierId, reason, phase, supabaseError, details } = args;
  console.error("[bids] submit failed", {
    quoteId,
    supplierId,
    reason,
    phase,
    supabaseError,
    details,
  });
}

function parseLeadTimeDays(
  value: FormDataEntryValue | null,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: true, value: null };
  }

  const normalized = value.trim().replace(/[,]/g, "");
  if (normalized.length === 0) {
    return { ok: true, value: null };
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { ok: false, error: "Lead time must be zero or more days." };
  }

  return { ok: true, value: parsed };
}

function isBidsEnvErrorMessage(message?: string | null): boolean {
  if (!message) {
    return false;
  }
  return message.includes(SUPPLIER_BIDS_MISSING_SCHEMA_MESSAGE);
}
