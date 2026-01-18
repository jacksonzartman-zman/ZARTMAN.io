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

type RouteContext = {
  params: { quoteId?: string };
};

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const user = await requireUser({ redirectTo: "/customer/saved" });
    const customer = await getCustomerByUserId(user.id);
    if (!customer) {
      return NextResponse.json({ ok: false, error: "missing_profile" }, { status: 403 });
    }

    const quoteId = typeof context?.params?.quoteId === "string" ? context.params.quoteId.trim() : "";
    if (!quoteId) {
      return NextResponse.json({ ok: false, error: "invalid_quote" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as PatchBody | null;
    const label = typeof body?.label === "string" ? body.label.trim() : "";
    if (!label) {
      return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
    }

    const result = await renameCustomerSavedSearch({
      customerId: customer.id,
      quoteId,
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

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const user = await requireUser({ redirectTo: "/customer/saved" });
    const customer = await getCustomerByUserId(user.id);
    if (!customer) {
      return NextResponse.json({ ok: false, error: "missing_profile" }, { status: 403 });
    }

    const quoteId = typeof context?.params?.quoteId === "string" ? context.params.quoteId.trim() : "";
    if (!quoteId) {
      return NextResponse.json({ ok: false, error: "invalid_quote" }, { status: 400 });
    }

    const result = await deleteCustomerSavedSearch({
      customerId: customer.id,
      quoteId,
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
