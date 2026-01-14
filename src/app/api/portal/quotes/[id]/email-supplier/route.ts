import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabaseServer";
import { UnauthorizedError, requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { schemaGate } from "@/server/db/schemaContract";
import { handleMissingSupabaseSchema, serializeSupabaseError, warnOnce } from "@/server/db/schemaErrors";
import { sendEmailToSupplierFromCustomer } from "@/server/quotes/emailPortalSend";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WARN_PREFIX = "[portal_email_supplier_api]";

type PostBody = {
  message?: string;
  attachmentFileIds?: string[];
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isUuidLike(value: string): boolean {
  const v = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export async function POST(req: Request, context: { params: Promise<{ id?: string }> }) {
  const params = await context.params;
  const quoteId = normalizeString(params?.id);

  try {
    const user = await requireUser({
      redirectTo: quoteId ? `/customer/quotes/${quoteId}` : "/customer/quotes",
    });

    if (!isUuidLike(quoteId)) {
      return NextResponse.json({ ok: false, error: "invalid_quote_id" }, { status: 400 });
    }

    const customer = await getCustomerByUserId(user.id);
    if (!customer) {
      return NextResponse.json({ ok: false, error: "missing_profile" }, { status: 403 });
    }

    const body = (await req.json().catch(() => null)) as PostBody | null;
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 5000) {
      return NextResponse.json({ ok: false, error: "invalid_message" }, { status: 400 });
    }

    const attachmentFileIds = Array.isArray(body?.attachmentFileIds)
      ? body!.attachmentFileIds
          .map((v) => (typeof v === "string" ? v.trim() : ""))
          .filter(Boolean)
          .slice(0, 5)
      : undefined;

    // Access control: customer must own the quote (id match) or be email-linked (email match).
    const quotesSupported = await schemaGate({
      enabled: true,
      relation: "quotes",
      requiredColumns: ["id", "customer_id", "customer_email"],
      warnPrefix: WARN_PREFIX,
      warnKey: "portal_email_supplier:quotes_access",
    });
    if (!quotesSupported) {
      return NextResponse.json({ ok: false, error: "unsupported" }, { status: 200 });
    }

    type QuoteRow = { id: string; customer_id: string | null; customer_email: string | null };
    const { data: quoteRow, error: quoteError } = await supabaseServer
      .from("quotes")
      .select("id,customer_id,customer_email")
      .eq("id", quoteId)
      .maybeSingle<QuoteRow>();

    if (quoteError) {
      if (
        handleMissingSupabaseSchema({
          relation: "quotes",
          error: quoteError,
          warnPrefix: WARN_PREFIX,
          warnKey: "portal_email_supplier:quotes_missing_schema",
        })
      ) {
        return NextResponse.json({ ok: false, error: "unsupported" }, { status: 200 });
      }
      warnOnce("portal_email_supplier:quote_lookup_failed", `${WARN_PREFIX} quote lookup failed`, {
        code: serializeSupabaseError(quoteError).code,
      });
      return NextResponse.json({ ok: false, error: "quote_not_found" }, { status: 404 });
    }

    if (!quoteRow) {
      return NextResponse.json({ ok: false, error: "quote_not_found" }, { status: 404 });
    }

    const quoteCustomerId = normalizeString(quoteRow.customer_id);
    const customerIdMatches = quoteCustomerId && quoteCustomerId === customer.id;
    const quoteEmail = normalizeEmailInput(quoteRow.customer_email);
    const customerEmail = normalizeEmailInput(customer.email);
    const emailMatches = Boolean(quoteEmail && customerEmail && quoteEmail === customerEmail);
    if (!customerIdMatches && !emailMatches) {
      return NextResponse.json({ ok: false, error: "access_denied" }, { status: 403 });
    }

    const result = await sendEmailToSupplierFromCustomer({
      quoteId,
      customerId: customer.id,
      message,
      attachmentFileIds,
    });

    if (!result.ok) {
      // Fail-soft: avoid retry churn from clients when disabled/unsupported/missing.
      return NextResponse.json({ ok: false, error: result.error }, { status: 200 });
    }

    return NextResponse.json({ ok: true, sent: true, attachmentsSent: result.attachmentsSent }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    console.error(`${WARN_PREFIX} crashed`, { quoteId, error: err });
    return NextResponse.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}

