import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabaseServer";
import { requireUser, UnauthorizedError } from "@/server/auth";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import { getCustomerByEmail, getCustomerByUserId } from "@/server/customers";
import { createQuoteMessage } from "@/server/quotes/messages";
import { emitQuoteEvent } from "@/server/quotes/events";

type ChangeType =
  | "tolerance"
  | "material_finish"
  | "lead_time"
  | "shipping"
  | "revision";

const CHANGE_TYPE_LABELS: Record<ChangeType, string> = {
  tolerance: "Tolerance",
  material_finish: "Material / finish",
  lead_time: "Lead time",
  shipping: "Shipping",
  revision: "Revision",
};

export async function GET() {
  return NextResponse.json({ ok: true, route: "change-requests" });
}

export async function POST(req: Request) {
  console.log("[change-requests] start");

  try {
    const body = (await req.json()) as
      | { quoteId?: unknown; changeType?: unknown; notes?: unknown }
      | null;

    const quoteId = typeof body?.quoteId === "string" ? body.quoteId.trim() : "";
    const changeType =
      typeof body?.changeType === "string" ? body.changeType.trim() : "";
    const normalizedChangeType = normalizeAndMapChangeType(changeType);
    const notesRaw = typeof body?.notes === "string" ? body.notes : "";
    const notes = notesRaw.trim();

    if (!isUuidLike(quoteId)) {
      return NextResponse.json(
        { ok: false, error: "invalid_quoteId" },
        { status: 400 },
      );
    }

    if (!normalizedChangeType) {
      return NextResponse.json(
        { ok: false, error: "invalid_changeType" },
        { status: 400 },
      );
    }

    if (notes.length < 1 || notes.length > 2000) {
      return NextResponse.json(
        { ok: false, error: "invalid_notes" },
        { status: 400 },
      );
    }

    const user = await requireUser();

    // Access control: must match existing customer quote flows (customer_id + email membership).
    const access = await assertCustomerCanAccessQuote({
      quoteId,
      userId: user.id,
      email: user.email ?? null,
    });

    const { data: changeRequest, error: changeRequestError } = await supabaseServer
      .from("quote_change_requests")
      .insert({
        quote_id: quoteId,
        created_by_user_id: user.id,
        created_by_role: "customer",
        change_type: normalizedChangeType,
        notes,
      })
      .select("id")
      .single<{ id: string }>();

    if (changeRequestError || !changeRequest?.id) {
      console.error("[change-requests] insert change request failed", {
        quoteId,
        userId: user.id,
        error: changeRequestError,
      });
      return NextResponse.json(
        { ok: false, error: "change_request_insert_failed" },
        { status: 500 },
      );
    }

    console.log("[change-requests] insert change request success");

    const label = CHANGE_TYPE_LABELS[normalizedChangeType];
    const messageBody = buildSystemMessageBody({
      label,
      notes,
    });

    const messageResult = await createQuoteMessage({
      quoteId,
      senderId: user.id,
      senderRole: "system",
      senderName: null,
      senderEmail: null,
      body: messageBody,
      customerId: access.customerId,
      supabase: supabaseServer,
    });

    if (!messageResult.ok) {
      console.error("[change-requests] insert message failed", {
        quoteId,
        userId: user.id,
        error: messageResult.error ?? messageResult.reason ?? "unknown",
      });
      return NextResponse.json(
        { ok: false, error: "message_insert_failed" },
        { status: 500 },
      );
    }

    console.log("[change-requests] insert message success");

    const eventResult = await emitQuoteEvent({
      quoteId,
      eventType: "change_request_created",
      actorRole: "system",
      actorUserId: user.id,
      metadata: {
        changeRequestId: changeRequest.id,
        changeType: normalizedChangeType,
        // Back-compat keys
        change_request_id: changeRequest.id,
        change_type: normalizedChangeType,
      },
    });

    if (!eventResult.ok) {
      console.error("[change-requests] event failed", {
        quoteId,
        changeRequestId: changeRequest.id,
        error: eventResult.error,
      });
      return NextResponse.json(
        { ok: false, error: "event_insert_failed" },
        { status: 500 },
      );
    }

    console.log("[change-requests] event success");

    return NextResponse.json({ ok: true, changeRequestId: changeRequest.id });
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    console.error("[change-requests] unexpected error", err);
    return NextResponse.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}

async function assertCustomerCanAccessQuote(args: {
  quoteId: string;
  userId: string;
  email: string | null;
}): Promise<{ quoteId: string; customerId: string | null; customerEmail: string | null }> {
  const quoteId = normalizeId(args.quoteId);
  const userId = normalizeId(args.userId);
  const userEmail = normalizeEmailInput(args.email ?? null);

  if (!quoteId || !userId) {
    throw new Error("invalid_input");
  }

  const customer = await getCustomerByUserId(userId);
  const customerFallback = !customer && userEmail ? await getCustomerByEmail(userEmail) : null;
  const customerId = normalizeId(customer?.id ?? customerFallback?.id ?? null) || null;
  const customerEmail = normalizeEmailInput(
    customer?.email ?? customerFallback?.email ?? userEmail,
  );

  if (!customerEmail && !customerId) {
    throw new Error("access_denied");
  }

  const { data: quoteRow, error: quoteError } = await supabaseServer
    .from("quotes")
    .select("id,customer_id,customer_email")
    .eq("id", quoteId)
    .maybeSingle<{
      id: string;
      customer_id: string | null;
      customer_email: string | null;
    }>();

  if (quoteError) {
    console.error("[change-requests] quote lookup failed", {
      quoteId,
      userId,
      error: quoteError,
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
    console.warn("[change-requests] access denied", {
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

function buildSystemMessageBody(args: { label: string; notes: string }): string {
  const prefix = `Change request created: ${args.label}. Notes: `;
  const available = 2000 - prefix.length;
  if (available <= 0) {
    return prefix.slice(0, 2000);
  }
  const notes =
    args.notes.length <= available
      ? args.notes
      : `${args.notes.slice(0, Math.max(0, available - 1))}…`;
  return `${prefix}${notes}`;
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isAllowedChangeType(value: string): value is ChangeType {
  return (
    value === "tolerance" ||
    value === "material_finish" ||
    value === "lead_time" ||
    value === "shipping" ||
    value === "revision"
  );
}

function normalizeAndMapChangeType(value: string): ChangeType | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!normalized) return null;
  if (isAllowedChangeType(normalized)) return normalized;

  // Back-compat: older UI options map into the canonical change request types.
  if (normalized === "timeline") return "lead_time";
  if (normalized === "design") return "revision";
  if (normalized === "quantity") return "revision";
  if (normalized === "files") return "revision";
  if (normalized === "other") return "revision";

  return null;
}

function isUuidLike(value: string): boolean {
  const v = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

