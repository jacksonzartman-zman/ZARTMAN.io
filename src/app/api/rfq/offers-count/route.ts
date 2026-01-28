import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  getRfqOffers,
  isRfqOfferWithdrawn,
  summarizeRfqOffers,
} from "@/server/rfqs/offers";
import { normalizeQuoteStatus } from "@/server/quotes/status";

export const dynamic = "force-dynamic";

function normalizeParam(value: string | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function isValidIntakeKey(key: string): boolean {
  return /^[a-f0-9]{16,128}$/.test(key);
}

type OfferCardDto = {
  id: string;
  providerName: string | null;
  currency: string;
  totalPrice: number | string | null;
  leadTimeDaysMin: number | null;
  leadTimeDaysMax: number | null;
  status: string;
  receivedAt: string | null;
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const quoteId = normalizeParam(searchParams.get("quote"));
  const intakeKey = normalizeKey(normalizeParam(searchParams.get("key")));

  if (!quoteId || !isValidIntakeKey(intakeKey)) {
    return NextResponse.json(
      { ok: false, error: "Invalid quote or key." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const client = supabaseServer();
  const quoteRes = await client
    .from("quotes")
    .select("id,upload_id,status")
    .eq("id", quoteId)
    .maybeSingle<{
      id: string;
      upload_id: string | null;
      status: string | null;
    }>();

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

  const uploadOk = Boolean(uploadRes.data?.id);
  if (!uploadOk) {
    return NextResponse.json(
      { ok: false, error: "Access denied." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const offers = await getRfqOffers(quote.id, { client });
  const summary = summarizeRfqOffers(offers);
  const nonWithdrawnOffers = offers.filter((offer) => !isRfqOfferWithdrawn(offer.status));

  const payloadOffers: OfferCardDto[] = nonWithdrawnOffers.map((offer) => ({
    id: offer.id,
    providerName: offer.provider?.name ?? null,
    currency: offer.currency,
    totalPrice: offer.total_price,
    leadTimeDaysMin: offer.lead_time_days_min ?? null,
    leadTimeDaysMax: offer.lead_time_days_max ?? null,
    status: offer.status,
    receivedAt: offer.received_at ?? offer.created_at ?? null,
  }));

  return NextResponse.json(
    {
      ok: true,
      quoteId: quote.id,
      quoteStatus: quote.status ?? null,
      normalizedStatus: normalizeQuoteStatus(quote.status ?? undefined),
      offersCount: summary.nonWithdrawn,
      offers: payloadOffers,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

