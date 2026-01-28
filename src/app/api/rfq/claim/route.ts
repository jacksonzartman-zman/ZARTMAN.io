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
    try {
      const user = await requireUser();
      userId = user.id;
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
      .select("id")
      .eq("id", uploadId)
      .eq("intake_idempotency_key", intakeKey)
      .maybeSingle<{ id: string }>();

    if (uploadError || !uploadRow?.id) {
      return jsonError("Unauthorized.", 401);
    }

    const existingCustomerId =
      typeof quoteRow.customer_id === "string" ? quoteRow.customer_id.trim() : "";

    // Idempotent + safe: if already claimed, do not reassign.
    if (existingCustomerId) {
      return NextResponse.json({ ok: true } satisfies ClaimOk, { status: 200 });
    }

    const baseUpdate: Record<string, unknown> = {
      customer_id: customer.id,
    };
    const updateWithActor: Record<string, unknown> = {
      ...baseUpdate,
      created_by_user_id: userId,
    };

    const attemptUpdate = async (payload: Record<string, unknown>) => {
      return await supabaseServer()
        .from("quotes")
        .update(payload)
        .eq("id", quoteId)
        .is("customer_id", null);
    };

    let updateResult = await attemptUpdate(updateWithActor);

    if (updateResult.error && isMissingTableOrColumnError(updateResult.error)) {
      // Fall back gracefully when `created_by_user_id` isn't in this environment.
      updateResult = await attemptUpdate(baseUpdate);
    }

    if (updateResult.error) {
      console.error("[rfq claim] update failed", {
        quoteId,
        userId,
        customerId: customer.id,
        error: serializeSupabaseError(updateResult.error) ?? updateResult.error,
      });
      return jsonError("Couldn’t save this RFQ. Please retry.", 500);
    }

    // Revalidate customer portal lists so the claimed RFQ appears immediately.
    revalidatePath("/customer");
    revalidatePath("/customer/quotes");

    return NextResponse.json({ ok: true } satisfies ClaimOk, { status: 200 });
  } catch (error) {
    console.error("[rfq claim] crashed", error);
    return jsonError("Unexpected server error.", 500);
  }
}

