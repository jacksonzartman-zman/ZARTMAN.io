import { NextResponse } from "next/server";

import { UnauthorizedError, requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import {
  deleteCustomerSavedSearch,
  renameCustomerSavedSearch,
} from "@/server/customer/savedSearches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WARN_PREFIX = "[portal_customer_saved_searches_item_api]";

type PatchBody = {
  label?: string;
};

type Params = {
  quoteId: string;
};

type Ctx = {
  params: Promise<Params>;
};

async function getQuoteIdFromCtx(ctx: Ctx) {
  const { quoteId } = await ctx.params;
  return quoteId;
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser({ redirectTo: "/customer/saved" });
    const customer = await getCustomerByUserId(user.id);
    if (!customer) {
      return NextResponse.json({ ok: false, error: "missing_profile" }, { status: 403 });
    }

    const quoteId = await getQuoteIdFromCtx(ctx);
    const normalizedQuoteId = typeof quoteId === "string" ? quoteId.trim() : "";
    if (!normalizedQuoteId) {
      return NextResponse.json({ ok: false, error: "invalid_quote" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as PatchBody | null;
    const label = typeof body?.label === "string" ? body.label.trim() : "";
    if (!label) {
      return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
    }

    const result = await renameCustomerSavedSearch({
      customerId: customer.id,
      quoteId: normalizedQuoteId,
      label,
    });
    if (!result.ok) {
      const status = result.reason === "invalid" ? 400 : 200;
      return NextResponse.json({ ok: false, error: result.reason }, { status });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    console.error(`${WARN_PREFIX} patch crashed`, { error: err });
    return NextResponse.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser({ redirectTo: "/customer/saved" });
    const customer = await getCustomerByUserId(user.id);
    if (!customer) {
      return NextResponse.json({ ok: false, error: "missing_profile" }, { status: 403 });
    }

    const quoteId = await getQuoteIdFromCtx(ctx);
    const normalizedQuoteId = typeof quoteId === "string" ? quoteId.trim() : "";
    if (!normalizedQuoteId) {
      return NextResponse.json({ ok: false, error: "invalid_quote" }, { status: 400 });
    }

    const result = await deleteCustomerSavedSearch({
      customerId: customer.id,
      quoteId: normalizedQuoteId,
    });
    if (!result.ok) {
      const status = result.reason === "invalid" ? 400 : 200;
      return NextResponse.json({ ok: false, error: result.reason }, { status });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    console.error(`${WARN_PREFIX} delete crashed`, { error: err });
    return NextResponse.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}
