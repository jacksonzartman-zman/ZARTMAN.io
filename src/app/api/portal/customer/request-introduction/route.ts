import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabaseServer";
import { UnauthorizedError, requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { schemaGate } from "@/server/db/schemaContract";
import { logOpsEvent } from "@/server/ops/events";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WARN_PREFIX = "[portal_customer_request_introduction_api]";

type PostBody = {
  quoteId?: string;
  providerId?: string;
  offerId?: string;
  email?: string;
  company?: string;
  notes?: string;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isUuidLike(value: string): boolean {
  const v = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export async function POST(req: Request) {
  try {
    const user = await requireUser({ redirectTo: "/customer/search" });
    const customer = await getCustomerByUserId(user.id);
    if (!customer) {
      return NextResponse.json({ ok: false, error: "missing_profile" }, { status: 403 });
    }

    const body = (await req.json().catch(() => null)) as PostBody | null;
    const quoteId = normalizeString(body?.quoteId);
    const providerId = normalizeString(body?.providerId);
    const offerId = normalizeString(body?.offerId);
    const email = normalizeEmailInput(body?.email ?? null);
    const company = normalizeString(body?.company);
    const notes = normalizeString(body?.notes);

    if (!isUuidLike(quoteId)) {
      return NextResponse.json({ ok: false, error: "invalid_quote" }, { status: 400 });
    }
    if (!providerId) {
      return NextResponse.json({ ok: false, error: "invalid_provider" }, { status: 400 });
    }
    if (!offerId) {
      return NextResponse.json({ ok: false, error: "invalid_offer" }, { status: 400 });
    }
    if (!email || !email.includes("@")) {
      return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
    }
    if (company.length > 200) {
      return NextResponse.json({ ok: false, error: "invalid_company" }, { status: 400 });
    }
    if (notes.length > 2000) {
      return NextResponse.json({ ok: false, error: "invalid_notes" }, { status: 400 });
    }

    type QuoteRow = { id: string; customer_id: string | null; customer_email: string | null };
    const { data: quoteRow, error: quoteError } = await supabaseServer
      .from("quotes")
      .select("id,customer_id,customer_email")
      .eq("id", quoteId)
      .maybeSingle<QuoteRow>();

    if (quoteError) {
      console.error(`${WARN_PREFIX} quote lookup failed`, { quoteId, error: quoteError });
      return NextResponse.json({ ok: false, error: "quote_lookup_failed" }, { status: 500 });
    }
    if (!quoteRow?.id) {
      return NextResponse.json({ ok: false, error: "quote_not_found" }, { status: 404 });
    }

    const quoteCustomerId = normalizeString(quoteRow.customer_id);
    const quoteEmail = normalizeEmailInput(quoteRow.customer_email);
    const customerEmail = normalizeEmailInput(customer.email);
    const customerIdMatches = Boolean(quoteCustomerId) && quoteCustomerId === customer.id;
    const emailMatches = Boolean(quoteEmail && customerEmail && quoteEmail === customerEmail);
    if (!customerIdMatches && !emailMatches) {
      return NextResponse.json({ ok: false, error: "access_denied" }, { status: 403 });
    }

    // Schema-gated: intro requests table is the source-of-truth for ops queue state.
    // Fail-soft: never block customer UX if the table isn't available yet.
    const introRequestsSupported = await schemaGate({
      enabled: true,
      relation: "intro_requests",
      requiredColumns: [
        "quote_id",
        "provider_id",
        "offer_id",
        "status",
        "requested_at",
        "handled_at",
        "handled_by_user_id",
        "customer_email",
        "company_name",
        "notes",
      ],
      warnPrefix: WARN_PREFIX,
      warnKey: "portal_customer_request_introduction:intro_requests",
    });

    if (introRequestsSupported && isUuidLike(providerId) && isUuidLike(offerId)) {
      try {
        await supabaseServer
          .from("intro_requests")
          .upsert(
            {
              quote_id: quoteId,
              provider_id: providerId,
              offer_id: offerId,
              customer_email: email,
              company_name: company || null,
              notes: notes || null,
              status: "open",
              requested_at: new Date().toISOString(),
              handled_at: null,
              handled_by_user_id: null,
            },
            { onConflict: "quote_id,provider_id,offer_id" },
          );
      } catch (error) {
        // Fail-soft; ops inbox can still fall back to ops_events.
        console.warn(`${WARN_PREFIX} intro_requests upsert failed`, { quoteId, providerId, error });
      }
    }

    // Fail-soft: `logOpsEvent` already swallows missing schema/constraint issues.
    void logOpsEvent({
      quoteId,
      eventType: "customer_intro_requested",
      payload: {
        provider_id: providerId,
        offer_id: offerId,
        customer_email: email,
        company_name: company || undefined,
        notes: notes || undefined,
        source: "customer_portal",
      },
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    console.error(`${WARN_PREFIX} crashed`, { error: err });
    return NextResponse.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}

