import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabaseServer";
import { UnauthorizedError, requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { schemaGate } from "@/server/db/schemaContract";
import { handleMissingSupabaseSchema, serializeSupabaseError, warnOnce } from "@/server/db/schemaErrors";
import { logOpsEvent } from "@/server/ops/events";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import { setCustomerSearchAlertPreference } from "@/server/customer/savedSearches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WARN_PREFIX = "[portal_customer_search_alerts_api]";

type PostBody = {
  quoteId?: string;
  enabled?: boolean;
  label?: string;
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
    if (!isUuidLike(quoteId)) {
      return NextResponse.json({ ok: false, error: "invalid_quote" }, { status: 400 });
    }
    if (typeof body?.enabled !== "boolean") {
      return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
    }
    const label = normalizeString(body?.label);

    const quotesSupported = await schemaGate({
      enabled: true,
      relation: "quotes",
      requiredColumns: ["id", "customer_id", "customer_email"],
      warnPrefix: WARN_PREFIX,
      warnKey: "customer_search_alerts:quotes_access",
    });
    if (!quotesSupported) {
      return NextResponse.json({ ok: false, error: "unsupported" }, { status: 200 });
    }

    type QuoteRow = { id: string; customer_id: string | null; customer_email: string | null };

    const { data: quoteRow, error: quoteError } = await supabaseServer()
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
          warnKey: "customer_search_alerts:quotes_missing_schema",
        })
      ) {
        return NextResponse.json({ ok: false, error: "unsupported" }, { status: 200 });
      }
      warnOnce(
        "customer_search_alerts:quotes_lookup_failed",
        `${WARN_PREFIX} quote lookup failed`,
        { code: serializeSupabaseError(quoteError).code },
      );
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

    const preferenceResult = await setCustomerSearchAlertPreference({
      customerId: customer.id,
      quoteId,
      enabled: body.enabled,
      label: label || undefined,
    });

    void logOpsEvent({
      quoteId,
      eventType: body.enabled ? "search_alert_enabled" : "search_alert_disabled",
      payload: {
        stored: preferenceResult.ok ? preferenceResult.stored : false,
        source: "portal",
      },
    });

    return NextResponse.json(
      {
        ok: true,
        stored: preferenceResult.ok ? preferenceResult.stored : false,
      },
      { status: 200 },
    );
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    console.error(`${WARN_PREFIX} crashed`, { error: err });
    return NextResponse.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}
