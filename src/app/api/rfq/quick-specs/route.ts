import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

type ProcessKey = "cnc" | "3dp" | "sheet" | "injection";

const PROCESS_LABEL_BY_KEY: Record<ProcessKey, string> = {
  cnc: "CNC machining",
  "3dp": "3D printing",
  sheet: "Sheet metal",
  injection: "Injection molding",
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeKey(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function isValidIntakeKey(key: string): boolean {
  return /^[a-f0-9]{16,128}$/.test(key);
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map((v) => Number(v));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return Number.isFinite(dt.getTime()) && dt.toISOString().slice(0, 10) === value;
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | {
          quoteId?: unknown;
          intakeKey?: unknown;
          manufacturingProcesses?: unknown;
          targetDate?: unknown;
          quantity?: unknown;
        }
      | null;

    const quoteId = normalizeText(body?.quoteId);
    const intakeKey = normalizeKey(body?.intakeKey);

    if (!quoteId) {
      return jsonError("Missing quote id.");
    }
    if (!isValidIntakeKey(intakeKey)) {
      return jsonError("Unauthorized.", 401);
    }

    const { data: quoteRow, error: quoteError } = await supabaseServer()
      .from("quotes")
      .select("id,upload_id")
      .eq("id", quoteId)
      .maybeSingle<{ id: string; upload_id: string | null }>();

    if (quoteError || !quoteRow?.id || !quoteRow.upload_id) {
      return jsonError("Unauthorized.", 401);
    }

    const uploadId = quoteRow.upload_id;

    const { data: uploadRow, error: uploadError } = await supabaseServer()
      .from("uploads")
      .select("id")
      .eq("id", uploadId)
      .eq("intake_idempotency_key", intakeKey)
      .maybeSingle<{ id: string }>();

    if (uploadError || !uploadRow?.id) {
      return jsonError("Unauthorized.", 401);
    }

    const processKeysRaw = Array.isArray(body?.manufacturingProcesses)
      ? (body?.manufacturingProcesses as unknown[])
      : undefined;
    const processKeys = processKeysRaw
      ? processKeysRaw
          .map((v) => normalizeKey(v))
          .filter((v): v is ProcessKey => v === "cnc" || v === "3dp" || v === "sheet" || v === "injection")
      : undefined;

    const targetDateRaw = body?.targetDate === null ? null : normalizeText(body?.targetDate);
    const targetDate =
      targetDateRaw === null || targetDateRaw.length === 0
        ? null
        : isValidIsoDate(targetDateRaw)
          ? targetDateRaw
          : null;

    const quantity =
      typeof body?.quantity === "number" && Number.isFinite(body.quantity)
        ? Math.max(1, Math.floor(body.quantity))
        : body?.quantity === null
          ? null
          : null;

    const uploadUpdates: Record<string, unknown> = {};
    if (processKeys !== undefined) {
      const labels = processKeys.map((k) => PROCESS_LABEL_BY_KEY[k]).filter(Boolean);
      uploadUpdates.manufacturing_process = labels.length > 0 ? labels.join(", ") : null;
    }
    if (body?.quantity !== undefined) {
      uploadUpdates.quantity = quantity === null ? null : String(quantity);
    }

    const quoteUpdates: Record<string, unknown> = {};
    if (body?.targetDate !== undefined) {
      quoteUpdates.target_date = targetDate;
    }

    if (Object.keys(uploadUpdates).length > 0) {
      const { error } = await supabaseServer()
        .from("uploads")
        .update(uploadUpdates)
        .eq("id", uploadId);
      if (error) {
        return jsonError("Couldn’t save. Please retry.", 500);
      }
    }

    if (Object.keys(quoteUpdates).length > 0) {
      const { error } = await supabaseServer()
        .from("quotes")
        .update(quoteUpdates)
        .eq("id", quoteId);
      if (error) {
        return jsonError("Couldn’t save. Please retry.", 500);
      }
    }

    return NextResponse.json(
      {
        ok: true,
        saved: {
          manufacturing_process:
            processKeys !== undefined
              ? processKeys.map((k) => PROCESS_LABEL_BY_KEY[k]).join(", ") || null
              : undefined,
          quantity: body?.quantity !== undefined ? (quantity === null ? null : quantity) : undefined,
          target_date: body?.targetDate !== undefined ? targetDate : undefined,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[rfq quick specs] crashed", error);
    return jsonError("Unexpected server error.", 500);
  }
}

