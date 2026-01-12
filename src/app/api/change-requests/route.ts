import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabaseServer";
import { requireUser, UnauthorizedError } from "@/server/auth";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import { getCustomerByEmail, getCustomerByUserId } from "@/server/customers";
import { createQuoteMessage } from "@/server/quotes/messages";
import { emitQuoteEvent } from "@/server/quotes/events";
import {
  notifyOnChangeRequestSubmitted,
  type ChangeRequestSubmittedNotificationResult,
} from "@/server/quotes/notifications";

type ChangeType =
  | "tolerance"
  | "material_finish"
  | "lead_time"
  | "shipping"
  | "revision";

const SYSTEM_SENDER_ID = "00000000-0000-0000-0000-000000000000";
const SYSTEM_SENDER_NAME = "System";

const CHANGE_TYPE_LABELS: Record<ChangeType, string> = {
  tolerance: "Tolerance",
  material_finish: "Material / finish",
  lead_time: "Lead time",
  shipping: "Shipping",
  revision: "Revision",
};

const CHANGE_REQUEST_NOTIFICATION_DEDUPE_EVENT_TYPE =
  "change_request_notification_sent";

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

    console.log("[change-requests] insert change request success", {
      quoteId,
      changeRequestId: changeRequest.id,
    });

    const label = CHANGE_TYPE_LABELS[normalizedChangeType];
    const messageBody = buildSystemMessageBody({
      label,
      notes,
    });

    const warnings: string[] = [];
    const senderName = SYSTEM_SENDER_NAME;
    const senderEmail = null;

    console.log("[change-requests] insert message payload", {
      quoteId,
      changeRequestId: changeRequest.id,
      senderId: SYSTEM_SENDER_ID,
      senderRole: "system",
      senderName,
      senderEmail,
      label,
      notesLen: notes.length,
      body: `Change request created: ${label}. Notes: <redacted>`,
    });

    const messageResult = await createQuoteMessage({
      quoteId,
      senderId: SYSTEM_SENDER_ID,
      senderRole: "system",
      senderName,
      senderEmail,
      body: messageBody,
      supabase: supabaseServer,
    });

    if (!messageResult.ok) {
      console.error("[change-requests] insert message failed", {
        quoteId,
        userId: user.id,
        error: messageResult.error ?? messageResult.reason ?? "unknown",
      });
      warnings.push("message_insert_failed");
    } else {
      console.log("[change-requests] insert message success", {
        quoteId,
        changeRequestId: changeRequest.id,
        messageId: messageResult.message?.id ?? null,
      });
    }

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

    const notificationOutcome = await maybeDispatchChangeRequestNotifications({
      quoteId,
      changeRequestId: changeRequest.id,
      changeType: normalizedChangeType,
      notes,
      requesterEmail: user.email ?? null,
      requesterUserId: user.id,
    });

    if (notificationOutcome?.warning) {
      warnings.push(notificationOutcome.warning);
    }

    return NextResponse.json({
      ok: true,
      changeRequestId: changeRequest.id,
      ...(warnings.length ? { warnings } : null),
    });
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    console.error("[change-requests] unexpected error", err);
    return NextResponse.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}

async function maybeDispatchChangeRequestNotifications(args: {
  quoteId: string;
  changeRequestId: string;
  changeType: string;
  notes: string;
  requesterEmail: string | null;
  requesterUserId: string;
}): Promise<
  | { ok: true; warning: string | null; result: ChangeRequestSubmittedNotificationResult | null }
  | { ok: false; warning: string; result: null }
> {
  console.log("[change-requests] notify start", {
    quoteId: args.quoteId,
    changeRequestId: args.changeRequestId,
    notesLen: args.notes.length,
  });

  let dedupeHit = false;
  try {
    dedupeHit = await hasChangeRequestNotificationDedupeMarker({
      quoteId: args.quoteId,
      changeRequestId: args.changeRequestId,
    });
  } catch (error) {
    console.warn("[change-requests] notification dedupe check failed", {
      quoteId: args.quoteId,
      changeRequestId: args.changeRequestId,
      error,
    });
  }

  if (dedupeHit) {
    console.log("[change-requests] notification dedupe hit", {
      changeRequestId: args.changeRequestId,
    });
    return { ok: true, warning: null, result: null };
  }

  let result: ChangeRequestSubmittedNotificationResult | null = null;

  try {
    result = await notifyOnChangeRequestSubmitted({
      quoteId: args.quoteId,
      changeRequestId: args.changeRequestId,
      changeType: args.changeType,
      notes: args.notes,
      requesterEmail: args.requesterEmail,
      requesterUserId: args.requesterUserId,
    });
  } catch (error) {
    console.error("[change-requests] notify failed", {
      quoteId: args.quoteId,
      changeRequestId: args.changeRequestId,
      error,
      notesLen: args.notes.length,
    });
    return { ok: false, warning: "notification_failed", result: null };
  }

  console.log("[change-requests] notify result", {
    quoteId: args.quoteId,
    changeRequestId: args.changeRequestId,
    admin: result.admin,
    customer: result.customer,
    customerSkipReason: result.customerSkipReason,
    notesLen: args.notes.length,
  });

  const marker = await emitQuoteEvent({
    quoteId: args.quoteId,
    eventType: CHANGE_REQUEST_NOTIFICATION_DEDUPE_EVENT_TYPE,
    actorRole: "system",
    actorUserId: args.requesterUserId,
    metadata: {
      changeRequestId: args.changeRequestId,
      changeType: args.changeType,
      audiences: {
        admin: result.admin,
        customer: result.customer,
      },
      skips: {
        customer: result.customerSkipReason,
      },
      // Back-compat keys
      change_request_id: args.changeRequestId,
      change_type: args.changeType,
    },
  });

  if (!marker.ok) {
    console.warn("[change-requests] notification marker insert failed", {
      quoteId: args.quoteId,
      changeRequestId: args.changeRequestId,
      error: marker.error,
    });
    return { ok: true, warning: "notification_marker_failed", result };
  }

  return { ok: true, warning: null, result };
}

async function hasChangeRequestNotificationDedupeMarker(args: {
  quoteId: string;
  changeRequestId: string;
}): Promise<boolean> {
  const quoteId = normalizeId(args.quoteId);
  const changeRequestId = normalizeId(args.changeRequestId);
  if (!quoteId || !changeRequestId) return false;

  const { data, error } = await supabaseServer
    .from("quote_events")
    .select("id,metadata,payload,created_at")
    .eq("quote_id", quoteId)
    .eq("event_type", CHANGE_REQUEST_NOTIFICATION_DEDUPE_EVENT_TYPE)
    .order("created_at", { ascending: false })
    .limit(25)
    .returns<
      Array<{
        id: string;
        metadata?: unknown;
        payload?: unknown;
        created_at: string;
      }>
    >();

  if (error) {
    throw error;
  }

  for (const row of data ?? []) {
    const metadata = isRecord(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : isRecord(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {};
    const markerId =
      readString(metadata, "changeRequestId") ??
      readString(metadata, "change_request_id");
    if (markerId && markerId === changeRequestId) {
      return true;
    }
  }

  return false;
}

async function assertCustomerCanAccessQuote(args: {
  quoteId: string;
  userId: string;
  email: string | null;
}): Promise<{
  quoteId: string;
  customerId: string | null;
  customerEmail: string | null;
  customerName: string | null;
}> {
  const quoteId = normalizeId(args.quoteId);
  const userId = normalizeId(args.userId);
  const userEmail = normalizeEmailInput(args.email ?? null);

  if (!quoteId || !userId) {
    throw new Error("invalid_input");
  }

  const customer = await getCustomerByUserId(userId);
  const customerFallback =
    !customer && userEmail ? await getCustomerByEmail(userEmail) : null;
  const customerId = normalizeId(customer?.id ?? customerFallback?.id ?? null) || null;
  const customerEmail = normalizeEmailInput(
    customer?.email ?? customerFallback?.email ?? userEmail,
  );
  const customerName =
    customer?.company_name ??
    customer?.email ??
    customerFallback?.company_name ??
    customerFallback?.email ??
    userEmail ??
    null;

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

  return { quoteId, customerId, customerEmail, customerName };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
  // The customer UI should send canonical values only, but we keep this mapping
  // for safety with stale clients.
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

