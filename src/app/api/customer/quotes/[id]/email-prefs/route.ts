import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabaseServer";
import { UnauthorizedError, requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { schemaGate } from "@/server/db/schemaContract";
import { handleMissingSupabaseSchema, serializeSupabaseError, warnOnce } from "@/server/db/schemaErrors";
import { setCustomerEmailOptIn } from "@/server/quotes/customerEmailPrefs";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WARN_PREFIX = "[customer_email_prefs_api]";

type PostBody = {
  enabled?: boolean;
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
    if (typeof body?.enabled !== "boolean") {
      return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
    }

    const quotesSupported = await schemaGate({
      enabled: true,
      relation: "quotes",
      requiredColumns: ["id", "customer_id", "customer_email"],
      warnPrefix: WARN_PREFIX,
      warnKey: "customer_email_prefs:quotes_access",
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
          warnKey: "customer_email_prefs:quotes_missing_schema",
        })
      ) {
        return NextResponse.json({ ok: false, error: "unsupported" }, { status: 200 });
      }
      warnOnce("customer_email_prefs:quotes_lookup_failed", `${WARN_PREFIX} quote lookup failed`, {
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

    const result = await setCustomerEmailOptIn({
      quoteId,
      customerId: customer.id,
      enabled: body.enabled,
    });

    if (!result.ok) {
      // Fail-soft: safe deployments should not retry on unsupported/disabled.
      return NextResponse.json({ ok: false, error: result.error }, { status: 200 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    console.error(`${WARN_PREFIX} crashed`, { quoteId, error: err });
    return NextResponse.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}

