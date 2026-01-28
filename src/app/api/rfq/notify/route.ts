import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

function normalizeParam(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function isValidIntakeKey(key: string): boolean {
  return /^[a-f0-9]{16,128}$/.test(key);
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  // Intentionally simple. Goal: catch obvious mistakes and avoid pathological input.
  if (!email || email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const DUPLICATE_COOLDOWN_SECONDS = 30;

type RequestBody = {
  quoteId?: unknown;
  intakeKey?: unknown;
  email?: unknown;
};

export async function POST(req: Request) {
  let body: RequestBody | null = null;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    body = null;
  }

  const quoteId = normalizeParam(body?.quoteId);
  const intakeKey = normalizeKey(normalizeParam(body?.intakeKey));
  const email = normalizeEmail(normalizeParam(body?.email));

  if (!quoteId || !isValidIntakeKey(intakeKey)) {
    return NextResponse.json(
      { ok: false, error: "Invalid quote or key." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!isValidEmail(email)) {
    return NextResponse.json(
      { ok: false, error: "Please enter a valid email." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const client = supabaseServer();

  // Verify quote exists and the public RFQ key matches the upload intake idempotency key.
  const quoteRes = await client
    .from("quotes")
    .select("id,upload_id")
    .eq("id", quoteId)
    .maybeSingle<{ id: string; upload_id: string | null }>();

  const quote = quoteRes.data?.id ? quoteRes.data : null;
  if (!quote?.id || !quote.upload_id) {
    return NextResponse.json(
      { ok: false, error: "Quote not found." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const uploadRes = await client
    .from("uploads")
    .select("id,intake_idempotency_key")
    .eq("id", quote.upload_id)
    .eq("intake_idempotency_key", intakeKey)
    .maybeSingle<{ id: string; intake_idempotency_key: string | null }>();

  if (!uploadRes.data?.id) {
    return NextResponse.json(
      { ok: false, error: "Access denied." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Lightweight rate limiting / idempotency:
  // - unique (quote_id, email_lower) prevents repeated submits from creating rows
  // - cooldown prevents repeated submits from spamming writes
  const existingRes = await client
    .from("quote_notifications")
    .select("id,last_requested_at")
    .eq("quote_id", quoteId)
    .eq("email_lower", email)
    .maybeSingle<{ id: string; last_requested_at: string | null }>();

  const lastRequestedAt = existingRes.data?.last_requested_at
    ? Date.parse(existingRes.data.last_requested_at)
    : null;

  if (typeof lastRequestedAt === "number" && Number.isFinite(lastRequestedAt)) {
    const elapsedSeconds = (Date.now() - lastRequestedAt) / 1000;
    if (elapsedSeconds >= 0 && elapsedSeconds < DUPLICATE_COOLDOWN_SECONDS) {
      return NextResponse.json(
        { ok: true, status: "cooldown" as const },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  const upsertRes = await client
    .from("quote_notifications")
    .upsert(
      {
        quote_id: quoteId,
        email,
        email_lower: email,
        last_requested_at: new Date().toISOString(),
      },
      { onConflict: "quote_id,email_lower" },
    )
    .select("id")
    .maybeSingle<{ id: string }>();

  if (upsertRes.error) {
    return NextResponse.json(
      { ok: false, error: "Unable to save notification request." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { ok: true, status: "saved" as const, id: upsertRes.data?.id ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}

