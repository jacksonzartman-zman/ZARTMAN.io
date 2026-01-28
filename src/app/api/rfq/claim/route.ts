import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabaseServer";
import { UnauthorizedError, requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { isMissingTableOrColumnError, serializeSupabaseError } from "@/server/admin/logging";

export const runtime = "nodejs";

type ClaimOk = { ok: true };
type ClaimErr = { ok: false; error: string };

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeKey(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function isValidIntakeKey(key: string): boolean {
  return /^[a-f0-9]{16,128}$/.test(key);
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message } satisfies ClaimErr, { status });
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { quoteId?: unknown; intakeKey?: unknown }
      | null;

    const quoteId = normalizeText(body?.quoteId);
    const intakeKey = normalizeKey(body?.intakeKey);

    if (!quoteId) {
      return jsonError("Missing quote id.");
    }
    if (!isValidIntakeKey(intakeKey)) {
      return jsonError("Unauthorized.", 401);
    }

    let userId: string;
    let userEmail: string | null = null;
    let userMetadata: Record<string, unknown> | null = null;
    try {
      const user = await requireUser();
      userId = user.id;
      userEmail = normalizeEmail(user.email ?? null);
      userMetadata =
        user.user_metadata && typeof user.user_metadata === "object"
          ? (user.user_metadata as Record<string, unknown>)
          : null;
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return jsonError("Authentication required.", 401);
      }
      throw error;
    }

    const customer = await getCustomerByUserId(userId);
    if (!customer?.id) {
      return jsonError("Complete your customer profile to save this RFQ.", 403);
    }

    const customerId = customer.id;
    const customerEmail = normalizeEmail(customer.email) ?? userEmail;

    const { data: quoteRow, error: quoteError } = await supabaseServer()
      .from("quotes")
      .select("id,upload_id,customer_id")
      .eq("id", quoteId)
      .maybeSingle<{ id: string; upload_id: string | null; customer_id: string | null }>();

    if (quoteError || !quoteRow?.id || !quoteRow.upload_id) {
      return jsonError("Unauthorized.", 401);
    }

    const uploadId = quoteRow.upload_id;

    const { data: uploadRow, error: uploadError } = await supabaseServer()
      .from("uploads")
      .select("*")
      .eq("id", uploadId)
      .eq("intake_idempotency_key", intakeKey)
      .maybeSingle<Record<string, unknown>>();

    if (uploadError || !uploadRow?.id) {
      return jsonError("Unauthorized.", 401);
    }

    const existingQuoteCustomerId = normalizeId(quoteRow.customer_id);
    const existingUploadCustomerId = normalizeId(uploadRow.customer_id);

    // Idempotency + safety:
    // - If already claimed by this workspace, return success (and optionally backfill metadata).
    // - If claimed by another workspace, do not change.
    if (existingQuoteCustomerId && existingQuoteCustomerId !== customerId) {
      return jsonError("Claimed by another workspace.", 409);
    }
    if (existingUploadCustomerId && existingUploadCustomerId !== customerId) {
      return jsonError("Claimed by another workspace.", 409);
    }

    const viewerName =
      normalizeDisplayName(userMetadata?.full_name) ??
      normalizeDisplayName(userMetadata?.name) ??
      null;

    const client = supabaseServer();

    const attemptQuoteUpdate = async (payload: Record<string, unknown>) => {
      return await client
        .from("quotes")
        .update(payload)
        .eq("id", quoteId)
        .is("customer_id", null);
    };

    // Claim quote (only if unclaimed).
    if (!existingQuoteCustomerId) {
      const baseUpdate: Record<string, unknown> = {
        customer_id: customerId,
      };
      if (customerEmail) {
        // Helpful for legacy portal lists that still key off customer_email.
        baseUpdate.customer_email = customerEmail;
      }
      const updateWithActor: Record<string, unknown> = {
        ...baseUpdate,
        created_by_user_id: userId,
      };

      let updateResult = await attemptQuoteUpdate(updateWithActor);

      if (updateResult.error && isMissingTableOrColumnError(updateResult.error)) {
        // Fall back gracefully when optional columns aren't present in this environment.
        updateResult = await attemptQuoteUpdate(baseUpdate);
      }

      if (updateResult.error) {
        console.error("[rfq claim] update failed", {
          quoteId,
          userId,
          customerId,
          error: serializeSupabaseError(updateResult.error) ?? updateResult.error,
        });
        return jsonError("Couldn’t save this RFQ. Please retry.", 500);
      }

      // Handle a concurrent claim (another workspace could have claimed between read and update).
      const { data: reloadedQuote, error: reloadError } = await client
        .from("quotes")
        .select("id,customer_id")
        .eq("id", quoteId)
        .maybeSingle<{ id: string; customer_id: string | null }>();
      if (reloadError || !reloadedQuote?.id) {
        return jsonError("Couldn’t save this RFQ. Please retry.", 500);
      }
      const finalCustomerId = normalizeId(reloadedQuote.customer_id);
      if (finalCustomerId && finalCustomerId !== customerId) {
        return jsonError("Claimed by another workspace.", 409);
      }
    }

    // Claim upload (only if unclaimed).
    if (!existingUploadCustomerId) {
      const uploadPayload: Record<string, unknown> = {
        customer_id: customerId,
      };

      const existingUploadEmail = normalizeEmail(uploadRow.email ?? uploadRow.contact_email);
      const existingUploadName = normalizeDisplayName(uploadRow.name ?? uploadRow.contact_name);

      if (!existingUploadEmail && customerEmail) {
        // Prefer legacy `email` if present; fall back to `contact_email` in some schemas.
        uploadPayload.email = customerEmail;
        uploadPayload.contact_email = customerEmail;
      }

      if (!existingUploadName && viewerName) {
        // Prefer legacy `name` if present; fall back to `contact_name` in some schemas.
        uploadPayload.name = viewerName;
        uploadPayload.contact_name = viewerName;
      }

      const attemptUploadUpdate = async (payload: Record<string, unknown>) => {
        return await client
          .from("uploads")
          .update(payload)
          .eq("id", uploadId)
          .is("customer_id", null);
      };

      let uploadUpdateResult = await attemptUploadUpdate(uploadPayload);

      if (uploadUpdateResult.error && isMissingTableOrColumnError(uploadUpdateResult.error)) {
        // Fall back gracefully when optional metadata columns aren't present.
        const minimal: Record<string, unknown> = { customer_id: customerId };
        if (!existingUploadEmail && customerEmail) {
          // Try the most common legacy column name.
          minimal.email = customerEmail;
        }
        if (!existingUploadName && viewerName) {
          minimal.name = viewerName;
        }
        uploadUpdateResult = await attemptUploadUpdate(minimal);
      }

      if (uploadUpdateResult.error) {
        console.error("[rfq claim] upload update failed", {
          quoteId,
          uploadId,
          userId,
          customerId,
          error: serializeSupabaseError(uploadUpdateResult.error) ?? uploadUpdateResult.error,
        });
        return jsonError("Couldn’t save this RFQ. Please retry.", 500);
      }

      // Handle a concurrent claim.
      const { data: reloadedUpload, error: reloadUploadError } = await client
        .from("uploads")
        .select("id,customer_id")
        .eq("id", uploadId)
        .maybeSingle<{ id: string; customer_id: string | null }>();
      if (reloadUploadError || !reloadedUpload?.id) {
        return jsonError("Couldn’t save this RFQ. Please retry.", 500);
      }
      const finalUploadCustomerId = normalizeId(reloadedUpload.customer_id);
      if (finalUploadCustomerId && finalUploadCustomerId !== customerId) {
        return jsonError("Claimed by another workspace.", 409);
      }
    }

    console.log("[claim] updated quote", { quoteId, customerId });
    console.log("[claim] updated upload", { uploadId, customerId });

    // Revalidate customer portal lists so the claimed RFQ appears immediately.
    revalidatePath("/customer");
    revalidatePath("/customer/quotes");
    revalidatePath("/customer/search");

    return NextResponse.json({ ok: true } satisfies ClaimOk, { status: 200 });
  } catch (error) {
    console.error("[rfq claim] crashed", error);
    return jsonError("Unexpected server error.", 500);
  }
}

