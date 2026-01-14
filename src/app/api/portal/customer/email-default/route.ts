import { NextResponse } from "next/server";

import { UnauthorizedError, requireUser } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { setCustomerEmailDefaultOptIn } from "@/server/quotes/customerEmailDefaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WARN_PREFIX = "[portal_customer_email_default_api]";

type PostBody = {
  enabled?: boolean;
};

export async function POST(req: Request) {
  try {
    const user = await requireUser({ redirectTo: "/customer/settings" });
    const customer = await getCustomerByUserId(user.id);
    if (!customer) {
      return NextResponse.json({ ok: false, error: "missing_profile" }, { status: 403 });
    }

    const body = (await req.json().catch(() => null)) as PostBody | null;
    if (typeof body?.enabled !== "boolean") {
      return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
    }

    const result = await setCustomerEmailDefaultOptIn(customer.id, body.enabled);
    if (!result.ok) {
      // Fail-soft: avoid retry churn on disabled/unsupported.
      return NextResponse.json({ ok: false, error: result.reason }, { status: 200 });
    }

    return NextResponse.json({ ok: true, enabled: body.enabled }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    console.error(`${WARN_PREFIX} crashed`, { error: err });
    return NextResponse.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}

