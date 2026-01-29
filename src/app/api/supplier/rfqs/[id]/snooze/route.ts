import { NextResponse } from "next/server";

import { requireUser, UnauthorizedError } from "@/server/auth";
import { loadSupplierProfileByUserId } from "@/server/suppliers";
import { getDemoSupplierProviderIdFromCookie } from "@/server/demo/demoSupplierProvider";
import { snoozeRfqDestinationAsSupplier } from "@/server/rfqs/snoozeDestination";

export async function POST(
  req: Request,
  context: { params: Promise<{ id?: string }> },
) {
  const params = await context.params;
  const rfqId = typeof params?.id === "string" ? params.id.trim() : "";

  try {
    const user = await requireUser();

    if (!isUuidLike(rfqId)) {
      return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as any;
    const hoursRaw = typeof body?.hours === "number" ? body.hours : null;
    const hours =
      typeof hoursRaw === "number" && Number.isFinite(hoursRaw)
        ? Math.min(24 * 30, Math.max(1, Math.floor(hoursRaw)))
        : 24;
    const snoozeUntilIso = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

    const profile = await loadSupplierProfileByUserId(user.id);
    const supplierProviderId =
      typeof (profile?.supplier as { provider_id?: string | null } | null)?.provider_id === "string"
        ? (profile?.supplier as any).provider_id.trim()
        : null;
    const demoProviderId = await getDemoSupplierProviderIdFromCookie();
    const effectiveProviderId = demoProviderId ?? supplierProviderId;

    if (!isUuidLike(effectiveProviderId ?? "")) {
      // Snooze is only supported for suppliers mapped to a marketplace provider.
      return NextResponse.json(
        { ok: false, error: "missing_provider_mapping" },
        { status: 403 },
      );
    }

    const result = await snoozeRfqDestinationAsSupplier({
      rfqId,
      providerId: effectiveProviderId,
      actorUserId: user.id,
      snoozeUntilIso,
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

    return NextResponse.json({ ok: true, snoozeUntil: result.snoozeUntil ?? snoozeUntilIso });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    console.error("[supplier rfq snooze api] crashed", { rfqId, error });
    return NextResponse.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

