import { NextResponse } from "next/server";

import { UnauthorizedError, requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { saveCustomerSearch } from "@/server/customer/savedSearches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WARN_PREFIX = "[portal_customer_saved_searches_api]";

type PostBody = {
  quoteId?: string;
  label?: string;
};

export async function POST(req: Request) {
  try {
    const user = await requireUser({ redirectTo: "/customer/search" });
    const customer = await getCustomerByUserId(user.id);
    if (!customer) {
      return NextResponse.json({ ok: false, error: "missing_profile" }, { status: 403 });
    }

    const body = (await req.json().catch(() => null)) as PostBody | null;
    const quoteId = typeof body?.quoteId === "string" ? body.quoteId.trim() : "";
    const label = typeof body?.label === "string" ? body.label.trim() : "";

    if (!quoteId || !label) {
      return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
    }

    const result = await saveCustomerSearch({
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
    console.error(`${WARN_PREFIX} crashed`, { error: err });
    return NextResponse.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}
