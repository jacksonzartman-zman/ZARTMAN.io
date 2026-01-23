import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser, UnauthorizedError } from "@/server/auth";
import { schemaGate } from "@/server/db/schemaContract";

export async function POST(
  req: Request,
  context: { params: Promise<{ id?: string }> },
) {
  const params = await context.params;
  const supplierId = typeof params?.id === "string" ? params.id.trim() : "";

  try {
    await requireAdminUser();

    if (!isUuidLike(supplierId)) {
      return NextResponse.json({ ok: false, error: "invalid_supplier_id" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as { status?: unknown } | null;
    const status = normalizeStatus(body?.status);
    if (!status) {
      return NextResponse.json({ ok: false, error: "invalid_status" }, { status: 400 });
    }

    const supported = await schemaGate({
      enabled: true,
      relation: "suppliers",
      requiredColumns: ["id", "status"],
      warnPrefix: "[take_action]",
      warnKey: "take_action:suppliers_status",
    });

    if (!supported) {
      // Per spec: only supported when `suppliers.status` exists.
      return NextResponse.json({ ok: false, error: "unsupported" }, { status: 200 });
    }

    const { data, error } = await supabaseServer()
      .from("suppliers")
      .update({ status })
      .eq("id", supplierId)
      .select("id,status")
      .maybeSingle<{ id: string; status: string | null }>();

    if (error) {
      return NextResponse.json({ ok: false, error: "write_failed" }, { status: 500 });
    }

    if (!data?.id) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      supplierId: data.id,
      status: typeof data.status === "string" ? data.status : status,
    });
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}

function normalizeStatus(value: unknown): "active" | "paused" | null {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (v === "active") return "active";
  if (v === "paused") return "paused";
  return null;
}

function isUuidLike(value: string): boolean {
  const v = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

