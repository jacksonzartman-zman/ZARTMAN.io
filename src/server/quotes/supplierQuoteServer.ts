import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabaseServer";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import { canUserBid } from "@/lib/permissions";
import { createAuthClient, getServerAuthUser, requireUser } from "@/server/auth";
import { loadBidForSupplierAndQuote } from "@/server/bids";
import {
  serializeSupabaseError,
  isMissingTableOrColumnError,
} from "@/server/admin/logging";
import { assertSupplierQuoteAccess } from "@/server/quotes/access";
import { createQuoteMessage } from "@/server/quotes/messages";
import { notifyAdminOnBidSubmitted } from "@/server/quotes/notifications";
import type { QuoteWithUploadsRow } from "@/server/quotes/types";
import type { QuoteMessageFormState } from "@/app/(portals)/components/QuoteMessagesThread.types";
import {
  loadSupplierProfile,
  loadSupplierProfileByUserId,
  getSupplierApprovalStatus,
  isSupplierApproved,
  type SupplierBidRow,
} from "@/server/suppliers";
import { approvalsEnabled } from "@/server/suppliers/flags";
import {
  SAFE_QUOTE_WITH_UPLOADS_FIELDS,
  type SafeQuoteWithUploadsField,
} from "@/server/suppliers/types";
import { toggleSupplierKickoffTask } from "@/server/quotes/kickoffTasks";

export type SupplierBidFormState = {
  ok: boolean;
  message?: string | null;
  error?: string | null;
  fieldErrors?: {
    price?: string;
    leadTimeDays?: string;
    notes?: string;
    [key: string]: string | undefined;
  };
};

export type SupplierKickoffFormState = {
  ok: boolean;
  message?: string | null;
  error?: string | null;
  fieldErrors?: {
    taskId?: string;
    [key: string]: string | undefined;
  };
};

export const SUPPLIER_MESSAGE_PROFILE_ERROR =
  "We couldn’t find your supplier profile.";
export const SUPPLIER_MESSAGE_GENERIC_ERROR =
  "We couldn’t send your message. Please try again.";
export const SUPPLIER_MESSAGE_DENIED_ERROR =
  "You don’t have access to this RFQ.";

export const BID_SUBMIT_ERROR = "We couldn't submit your bid. Please try again.";
export const BID_ENV_DISABLED_ERROR =
  "Bids are not enabled in this environment yet.";
export const BID_AMOUNT_INVALID_ERROR =
  "Enter a valid bid amount greater than 0.";
export const SUPPLIER_BIDS_MISSING_SCHEMA_MESSAGE =
  "Bids are not available in this environment.";

const QUOTE_ACCESS_SELECT = SAFE_QUOTE_WITH_UPLOADS_FIELDS.join(",");

type QuoteAccessRow = Pick<QuoteWithUploadsRow, SafeQuoteWithUploadsField>;

export async function loadQuoteAccessRow(quoteId: string) {
  return supabaseServer
    .from("quotes_with_uploads")
    .select(QUOTE_ACCESS_SELECT)
    .eq("id", quoteId)
    .maybeSingle<QuoteAccessRow>();
}

export function parseSupplierBidAmount(
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

export function logBidSubmitFailure(args: {
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

export function parseLeadTimeDays(
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

export function isBidsEnvErrorMessage(message?: string | null): boolean {
  if (!message) {
    return false;
  }
  return message.includes(SUPPLIER_BIDS_MISSING_SCHEMA_MESSAGE);
}

export const KICKOFF_TASKS_GENERIC_ERROR =
  "We couldn’t update the kickoff checklist. Please try again.";
export const KICKOFF_TASKS_SCHEMA_ERROR =
  "Kickoff checklist isn’t available in this environment yet.";

export type ToggleSupplierKickoffTaskInput = {
  quoteId: string;
  taskKey: string;
  completed: boolean;
  title?: string | null;
  description?: string | null;
  sortOrder?: number | null;
};

export function normalizeIdentifier(value?: string | null): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeTaskKey(value?: string | null): string {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  return key.replace(/[^a-z0-9_-]/gi, "");
}

export function normalizeTaskTitle(
  value: string | null | undefined,
  fallback: string,
): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim().slice(0, 120);
  }
  return fallback;
}

export function normalizeTaskDescription(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, 500);
}

export function normalizeSortOrder(value?: number | null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

export async function postSupplierMessageImpl(
  quoteId: string,
  formData: FormData,
): Promise<QuoteMessageFormState> {
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

    const profile = user.id ? await loadSupplierProfileByUserId(user.id) : null;

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
    const access = await assertSupplierQuoteAccess({
      quoteId: trimmedQuoteId,
      supplierId,
    });

    if (!access.ok) {
      console.warn("[supplier access] denied", {
        quoteId: trimmedQuoteId,
        supplierId,
        reason: access.reason,
      });
      return {
        ok: false,
        error: SUPPLIER_MESSAGE_DENIED_ERROR,
        fieldErrors: {},
      };
    }

    const authorName =
      profile.supplier.company_name ?? user.email ?? "Supplier";

    const authorEmail =
      profile.supplier.primary_email ?? user.email ?? "supplier@zartman.io";

    console.log("[supplier messages] create start", {
      quoteId: trimmedQuoteId,
      supplierId,
    });

    const supabase = createAuthClient();
    const result = await createQuoteMessage({
      quoteId: trimmedQuoteId,
      senderId: user.id,
      senderRole: "supplier",
      body,
      senderName: authorName,
      senderEmail: authorEmail,
      supabase,
    });

    if (!result.ok || !result.message) {
      const log = result.reason === "unauthorized" ? console.warn : console.error;
      log("[supplier messages] create failed", {
        quoteId: trimmedQuoteId,
        supplierId,
        error: result.error ?? result.reason,
      });

      return {
        ok: false,
        error:
          result.reason === "unauthorized"
            ? SUPPLIER_MESSAGE_DENIED_ERROR
            : typeof result.error === "string"
              ? result.error
              : SUPPLIER_MESSAGE_GENERIC_ERROR,
        fieldErrors: {},
      };
    }

    console.log("[supplier messages] create success", {
      quoteId: trimmedQuoteId,
      supplierId,
      messageId: result.message.id,
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

export async function submitSupplierBidImpl(
  formData: FormData,
): Promise<SupplierBidFormState> {
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
      fieldErrors.price = BID_AMOUNT_INVALID_ERROR;
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
      const amountError = fieldErrors.price
        ? BID_AMOUNT_INVALID_ERROR
        : "Fix the errors highlighted below.";
      return {
        ok: false,
        error: amountError,
        fieldErrors,
      };
    }

    let supplierProfile = user.id
      ? await loadSupplierProfileByUserId(user.id)
      : null;

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

    const access = await assertSupplierQuoteAccess({
      quoteId,
      supplierId: supplier.id,
    });
    if (!access.ok) {
      console.warn("[supplier access] denied", {
        quoteId,
        supplierId: supplier.id,
        reason: access.reason,
      });
      return {
        ok: false,
        error: "You do not have access to this RFQ.",
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

      if (!existingBid) {
        const quoteTitle =
          quote.file_name ?? quote.company ?? `Quote ${quote.id.slice(0, 6)}`;
        void notifyAdminOnBidSubmitted({
          quoteId,
          bidId: data?.id ?? null,
          supplierId: supplier.id,
          supplierName: supplier.company_name ?? supplier.primary_email ?? null,
          supplierEmail: supplier.primary_email ?? supplierEmail,
          amount: normalizedAmount,
          currency,
          leadTimeDays,
          quoteTitle,
        });
      }

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

export async function completeKickoffTaskImpl(
  input: ToggleSupplierKickoffTaskInput,
): Promise<SupplierKickoffFormState> {
  const quoteId = normalizeIdentifier(input?.quoteId);
  const taskKey = normalizeTaskKey(input?.taskKey);

  if (!quoteId || !taskKey) {
    return {
      ok: false,
      error: KICKOFF_TASKS_GENERIC_ERROR,
      fieldErrors: { taskId: "Missing identifiers." },
    };
  }

  const completed = Boolean(input?.completed);
  const title = normalizeTaskTitle(input?.title, taskKey);
  const description = normalizeTaskDescription(input?.description);
  const sortOrder = normalizeSortOrder(input?.sortOrder);

  try {
    const user = await requireUser({
      redirectTo: `/supplier/quotes/${quoteId}`,
      message: "Sign in to update kickoff tasks.",
    });

    const profile = user.id ? await loadSupplierProfileByUserId(user.id) : null;

    const resolvedSupplierId = normalizeIdentifier(profile?.supplier?.id ?? null);
    if (!resolvedSupplierId) {
      return {
        ok: false,
        error: SUPPLIER_MESSAGE_PROFILE_ERROR,
      };
    }

    const { data: quoteRow, error: quoteError } = await supabaseServer
      .from("quotes")
      .select("id,awarded_supplier_id")
      .eq("id", quoteId)
      .maybeSingle<{ id: string; awarded_supplier_id: string | null }>();

    if (quoteError) {
      console.error("[supplier kickoff tasks] quote lookup failed", {
        quoteId,
        supplierId: resolvedSupplierId,
        error: serializeSupabaseError(quoteError),
      });
      return {
        ok: false,
        error: KICKOFF_TASKS_GENERIC_ERROR,
      };
    }

    const awardedSupplierId = normalizeIdentifier(quoteRow?.awarded_supplier_id ?? null);
    if (!awardedSupplierId || awardedSupplierId !== resolvedSupplierId) {
      console.warn("[kickoff access] denied: not awarded supplier", {
        quoteId,
        supplierId: resolvedSupplierId,
        awardedSupplierId: awardedSupplierId || null,
      });
      return {
        ok: false,
        error: "You can’t update the kickoff checklist for this RFQ.",
      };
    }

    const access = await assertSupplierQuoteAccess({
      quoteId,
      supplierId: resolvedSupplierId,
    });

    if (!access.ok) {
      console.warn("[supplier access] denied", {
        quoteId,
        supplierId: resolvedSupplierId,
        reason: access.reason,
      });
      return {
        ok: false,
        error: "You don’t have access to this RFQ.",
      };
    }

    const supabase = createAuthClient();
    const result = await toggleSupplierKickoffTask(
      {
      quoteId,
      supplierId: resolvedSupplierId,
      taskKey,
      completed,
      title,
      description,
      sortOrder,
      },
      { supabase },
    );

    if (!result.ok) {
      if (result.reason === "schema-missing") {
        return {
          ok: false,
          error: KICKOFF_TASKS_SCHEMA_ERROR,
        };
      }
      if (result.reason === "denied") {
        console.warn("[kickoff access] denied: not awarded supplier", {
          quoteId,
          supplierId: resolvedSupplierId,
        });
        return {
          ok: false,
          error: "You can’t update the kickoff checklist for this RFQ.",
        };
      }
      return {
        ok: false,
        error: KICKOFF_TASKS_GENERIC_ERROR,
      };
    }

    revalidatePath(`/supplier/quotes/${quoteId}`);
    revalidatePath("/supplier");
    revalidatePath(`/customer/quotes/${quoteId}`);
    revalidatePath("/customer");
    revalidatePath(`/admin/quotes/${quoteId}`);
    revalidatePath("/admin/quotes");
    revalidatePath("/admin");

    return {
      ok: true,
      message: completed
        ? "Marked task complete."
        : "Marked task incomplete.",
    };
  } catch (error) {
    const serialized = serializeSupabaseError(error);
    console.error("[supplier kickoff tasks] action crashed", {
      quoteId,
      taskKey,
      error: serialized ?? error,
    });
    return {
      ok: false,
      error: KICKOFF_TASKS_GENERIC_ERROR,
    };
  }
}
