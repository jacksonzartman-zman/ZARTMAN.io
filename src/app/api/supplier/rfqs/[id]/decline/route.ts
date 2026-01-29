import { NextResponse } from "next/server";

import { requireUser, UnauthorizedError } from "@/server/auth";
import { loadSupplierProfileByUserId } from "@/server/suppliers";
import { getDemoSupplierProviderIdFromCookie } from "@/server/demo/demoSupplierProvider";
import { declineRfqDestinationAsSupplier } from "@/server/rfqs/declineDestination";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id?: string }> },
) {
  const params = await context.params;
  const rfqId = typeof params?.id === "string" ? params.id.trim() : "";

  try {
    const user = await requireUser();

    if (!isUuidLike(rfqId)) {
      return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
    }

    const profile = await loadSupplierProfileByUserId(user.id);
    const supplierProviderId =
      typeof (profile?.supplier as { provider_id?: string | null } | null)?.provider_id === "string"
        ? (profile?.supplier as any).provider_id.trim()
        : null;
    const demoProviderId = await getDemoSupplierProviderIdFromCookie();
    const effectiveProviderId = demoProviderId ?? supplierProviderId;

    if (!isUuidLike(effectiveProviderId ?? "")) {
      // Decline is only supported for suppliers mapped to a marketplace provider.
      return NextResponse.json(
        { ok: false, error: "missing_provider_mapping" },
        { status: 403 },
      );
    }

    const result = await declineRfqDestinationAsSupplier({
      rfqId,
      providerId: effectiveProviderId,
      actorUserId: user.id,
    });

    if (!result.ok) {
      if (result.error === "forbidden") {
        return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
      }
      if (result.error === "invalid_input") {
        return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
      }
      return NextResponse.json({ ok: false, error: "write_failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    console.error("[supplier rfq decline api] crashed", { rfqId, error });
    return NextResponse.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

