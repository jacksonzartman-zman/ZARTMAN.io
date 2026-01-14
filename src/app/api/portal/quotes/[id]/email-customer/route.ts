import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabaseServer";
import { UnauthorizedError, requireUser } from "@/server/auth";
import { loadSupplierProfileByUserId } from "@/server/suppliers";
import { assertSupplierQuoteAccess } from "@/server/quotes/access";
import { schemaGate } from "@/server/db/schemaContract";
import { handleMissingSupabaseSchema, serializeSupabaseError, warnOnce } from "@/server/db/schemaErrors";
import { sendEmailToCustomerFromSupplier } from "@/server/quotes/emailPortalSend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WARN_PREFIX = "[portal_email_customer_api]";

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
      redirectTo: quoteId ? `/supplier/quotes/${quoteId}` : "/supplier",
    });

    if (!isUuidLike(quoteId)) {
      return NextResponse.json({ ok: false, error: "invalid_quote_id" }, { status: 400 });
    }

    const profile = await loadSupplierProfileByUserId(user.id);
    const supplierId = normalizeString(profile?.supplier?.id ?? null);
    if (!isUuidLike(supplierId)) {
      return NextResponse.json({ ok: false, error: "missing_supplier_profile" }, { status: 403 });
    }

    // Access control: must have access AND be awarded supplier for this quote.
    const access = await assertSupplierQuoteAccess({
      quoteId,
      supplierId,
      supplierUserEmail: user.email ?? null,
    });
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const quotesSupported = await schemaGate({
      enabled: true,
      relation: "quotes",
      requiredColumns: ["id", "awarded_supplier_id"],
      warnPrefix: WARN_PREFIX,
      warnKey: "portal_email_customer:quotes_awarded_supplier_id",
    });
    if (!quotesSupported) {
      return NextResponse.json({ ok: false, error: "unsupported" }, { status: 200 });
    }

    const { data: quoteRow, error: quoteError } = await supabaseServer
      .from("quotes")
      .select("id,awarded_supplier_id")
      .eq("id", quoteId)
      .maybeSingle<{ id: string; awarded_supplier_id: string | null }>();

    if (quoteError) {
      if (
        handleMissingSupabaseSchema({
          relation: "quotes",
          error: quoteError,
          warnPrefix: WARN_PREFIX,
          warnKey: "portal_email_customer:quotes_missing_schema",
        })
      ) {
        return NextResponse.json({ ok: false, error: "unsupported" }, { status: 200 });
      }
      warnOnce("portal_email_customer:quote_lookup_failed", `${WARN_PREFIX} quote lookup failed`, {
        code: serializeSupabaseError(quoteError).code,
      });
      return NextResponse.json({ ok: false, error: "quote_not_found" }, { status: 404 });
    }

    if (!quoteRow) {
      return NextResponse.json({ ok: false, error: "quote_not_found" }, { status: 404 });
    }

    const awardedSupplierId = normalizeString(quoteRow.awarded_supplier_id);
    if (!awardedSupplierId || awardedSupplierId !== supplierId) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
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

    const result = await sendEmailToCustomerFromSupplier({
      quoteId,
      supplierId,
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

