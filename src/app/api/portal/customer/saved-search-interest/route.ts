import { NextResponse } from "next/server";

import { UnauthorizedError, requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { logOpsEvent } from "@/server/ops/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WARN_PREFIX = "[portal_customer_saved_search_interest_api]";

type PostBody = {
  quoteId?: string;
  email?: string;
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
    const email = typeof body?.email === "string" ? body.email.trim() : "";

    if (!quoteId) {
      return NextResponse.json({ ok: false, error: "invalid_quote" }, { status: 400 });
    }

    if (!email || !email.includes("@")) {
      return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
    }

    await logOpsEvent({
      quoteId,
      eventType: "customer_saved_search_interest",
      payload: {
        email: email.toLowerCase(),
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
