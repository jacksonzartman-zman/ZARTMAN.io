import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { emitRfqEvent } from "@/server/rfqs/events";

export const runtime = "nodejs";

type ProcessKey = "cnc" | "3dp" | "sheet" | "injection";

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

function normalizeProcessKeys(input: unknown): ProcessKey[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const keys = input
    .map((v) => normalizeKey(v))
    .filter((v): v is ProcessKey => v === "cnc" || v === "3dp" || v === "sheet" || v === "injection");
  // Preserve input order while deduping.
  return Array.from(new Set(keys));
}

function normalizeQuantityToNumericString(input: unknown): string | null | undefined {
  // undefined => no update, null => explicit clear, string => persist
  if (input === undefined) return undefined;
  if (input === null) return null;

  const raw =
    typeof input === "number" && Number.isFinite(input)
      ? String(Math.floor(input))
      : typeof input === "string"
        ? input.trim()
        : "";

  if (!raw) return null;

  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return String(parsed);
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
          // new names
          processes?: unknown;
          needByDate?: unknown;
          // legacy names (keep temporarily for compatibility)
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

    const processKeys =
      normalizeProcessKeys(body?.processes) ?? normalizeProcessKeys(body?.manufacturingProcesses);

    const needByDateInput = body?.needByDate !== undefined ? body?.needByDate : body?.targetDate;
    const needByDateRaw = needByDateInput === null ? null : normalizeText(needByDateInput);
    const needByDate =
      needByDateRaw === null || needByDateRaw.length === 0
        ? null
        : isValidIsoDate(needByDateRaw)
          ? needByDateRaw
          : null;

    const quantity = normalizeQuantityToNumericString(body?.quantity);

    const uploadUpdates: Record<string, unknown> = {};
    if (processKeys !== undefined) {
      // Store as comma-separated lowercase process keys: "cnc,3dp"
      uploadUpdates.manufacturing_process = processKeys.length > 0 ? processKeys.join(",") : null;
    }
    if (quantity !== undefined) {
      uploadUpdates.quantity = quantity;
    }

    const quoteUpdates: Record<string, unknown> = {};
    if (needByDateInput !== undefined) {
      quoteUpdates.target_date = needByDate;
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

    // Best-effort RFQ event log; never block quick specs save.
    try {
      void emitRfqEvent({
        rfqId: quoteId,
        eventType: "quick_specs_updated",
        actorRole: "customer",
        actorUserId: null,
      });
    } catch {
      // ignore
    }

    return NextResponse.json(
      {
        ok: true,
        saved: {
          manufacturing_process:
            processKeys !== undefined
              ? processKeys.join(",") || null
              : undefined,
          quantity: quantity !== undefined ? quantity : undefined,
          target_date: needByDateInput !== undefined ? needByDate : undefined,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[rfq quick specs] crashed", error);
    return jsonError("Unexpected server error.", 500);
  }
}

