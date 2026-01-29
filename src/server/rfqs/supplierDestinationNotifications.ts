import { supabaseServer } from "@/lib/supabaseServer";
import { dispatchEmailNotification } from "@/server/notifications/dispatcher";
import { emitRfqEvent } from "@/server/rfqs/events";
import {
  getProviderWithContactById,
  type ProviderContactRow,
  type ProviderEmailColumn,
} from "@/server/providers";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

type NotificationChannel = "email" | "activity";

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function buildPortalLink(path: string): string {
  return `${SITE_URL}${path}`;
}

function resolveProviderEmail(
  provider: ProviderContactRow | null,
  emailColumn: ProviderEmailColumn | null,
): string | null {
  if (!provider) return null;
  if (emailColumn === "primary_email") return normalizeEmail(provider.primary_email);
  if (emailColumn === "email") return normalizeEmail(provider.email);
  if (emailColumn === "contact_email") return normalizeEmail(provider.contact_email);
  return normalizeEmail(provider.primary_email ?? provider.email ?? provider.contact_email ?? null);
}

function isUniqueViolation(error: unknown): boolean {
  const serialized = serializeSupabaseError(error);
  return serialized?.code === "23505";
}

async function claimNotificationOnce(args: {
  rfqId: string;
  providerId: string;
  channel: NotificationChannel;
}): Promise<{ ok: true; claimed: boolean } | { ok: false; error: string }> {
  const rfqId = normalizeId(args.rfqId);
  const providerId = normalizeId(args.providerId);
  const channel = args.channel;
  if (!rfqId || !providerId) {
    return { ok: false, error: "invalid_input" };
  }

  try {
    const { error } = await supabaseServer()
      .from("rfq_destination_notifications")
      .insert({ rfq_id: rfqId, provider_id: providerId, channel });

    if (error) {
      if (isUniqueViolation(error)) {
        return { ok: true, claimed: false };
      }
      if (isMissingTableOrColumnError(error)) {
        // Best-effort fallback: schema isn't available, so we can't guarantee idempotency.
        // Still allow notifications to proceed.
        return { ok: true, claimed: true };
      }
      console.error("[supplier destination notify] claim insert failed", {
        rfqId,
        providerId,
        channel,
        error: serializeSupabaseError(error),
      });
      return { ok: false, error: "write_failed" };
    }

    return { ok: true, claimed: true };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return { ok: true, claimed: true };
    }
    console.error("[supplier destination notify] claim crashed", {
      rfqId,
      providerId,
      channel,
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, error: "write_failed" };
  }
}

type DestinationTokenRow = {
  id: string | null;
  offer_token: string | null;
  status: string | null;
};

async function loadDestinationToken(args: {
  rfqId: string;
  providerId: string;
}): Promise<{ ok: true; offerToken: string | null } | { ok: false; error: string }> {
  const rfqId = normalizeId(args.rfqId);
  const providerId = normalizeId(args.providerId);
  if (!rfqId || !providerId) return { ok: false, error: "invalid_input" };

  try {
    const { data, error } = await supabaseServer()
      .from("rfq_destinations")
      .select("id,offer_token,status")
      .eq("rfq_id", rfqId)
      .eq("provider_id", providerId)
      .maybeSingle<DestinationTokenRow>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return { ok: false, error: "missing_schema" };
      }
      console.error("[supplier destination notify] destination lookup failed", {
        rfqId,
        providerId,
        error: serializeSupabaseError(error),
      });
      return { ok: false, error: "lookup_failed" };
    }

    const token = normalizeId(data?.offer_token);
    return { ok: true, offerToken: token || null };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return { ok: false, error: "missing_schema" };
    }
    console.error("[supplier destination notify] destination lookup crashed", {
      rfqId,
      providerId,
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, error: "lookup_failed" };
  }
}

export async function notifySupplierOfRfqDestination(args: {
  rfqId: string;
  providerId: string;
}): Promise<{ ok: true; skipped: boolean } | { ok: false; error: string }> {
  const rfqId = normalizeId(args.rfqId);
  const providerId = normalizeId(args.providerId);
  if (!rfqId || !providerId) return { ok: false, error: "invalid_input" };

  // Claim "email" once per (rfq, provider). This provides idempotency.
  const claim = await claimNotificationOnce({ rfqId, providerId, channel: "email" });
  if (!claim.ok) {
    // Fail-soft: still attempt to log the in-app event.
    void emitRfqEvent({
      rfqId,
      eventType: "supplier_notified",
      actorRole: "system",
      actorUserId: null,
      message: `Supplier notify attempt failed to claim idempotency row for provider_id=${providerId}.`,
    });
    return { ok: false, error: claim.error };
  }
  if (!claim.claimed) {
    return { ok: true, skipped: true };
  }

  const [providerResult, tokenResult] = await Promise.all([
    getProviderWithContactById(providerId),
    loadDestinationToken({ rfqId, providerId }),
  ]);

  const provider = providerResult.provider ?? null;
  const providerName = provider?.name?.trim() ? provider.name.trim() : null;
  const providerEmail = resolveProviderEmail(provider, providerResult.emailColumn ?? null);

  const offerToken = tokenResult.ok ? tokenResult.offerToken : null;
  const offerLink = offerToken
    ? buildPortalLink(`/provider/offer/${encodeURIComponent(offerToken)}`)
    : null;

  const messageParts = [
    "Supplier notified",
    providerName ? `provider=${providerName}` : `provider_id=${providerId}`,
    providerEmail ? `email=${providerEmail}` : "email=missing",
    offerLink ? `offer_link=${offerLink}` : "offer_link=missing",
  ];

  // In-app event log (best-effort, non-blocking).
  void emitRfqEvent({
    rfqId,
    eventType: "supplier_notified",
    actorRole: "system",
    actorUserId: null,
    message: messageParts.join(" | "),
  });

  const subject = "New RFQ ready for your offer";
  const previewText = "A new RFQ has been routed to you. Open the link to submit your offer.";
  const html = `
    <p>A new RFQ has been routed to you.</p>
    ${
      offerLink
        ? `<p><a href="${offerLink}">Open RFQ and submit your offer</a></p>`
        : "<p>Offer link is currently unavailable. Please contact the Zartman team.</p>"
    }
  `;

  // Email send is fail-soft in the underlying email layer (missing RESEND key => warning only).
  await dispatchEmailNotification({
    eventType: "supplier_rfq_routed",
    quoteId: rfqId,
    recipientEmail: providerEmail,
    recipientRole: "supplier",
    actorRole: "system",
    audience: "supplier",
    subject,
    previewText,
    html,
    // If provider email is missing, do not treat as error; we still want the event + ledger row.
    skipIfMissingRecipient: true,
  });

  return { ok: true, skipped: false };
}

type PendingDestinationRow = { provider_id: string | null };

export async function notifySuppliersForPendingRfqDestinations(args: {
  rfqId: string;
}): Promise<void> {
  const rfqId = normalizeId(args.rfqId);
  if (!rfqId) return;

  let providerIds: string[] = [];

  try {
    const { data, error } = await supabaseServer()
      .from("rfq_destinations")
      .select("provider_id")
      .eq("rfq_id", rfqId)
      .eq("status", "pending")
      .returns<PendingDestinationRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return;
      console.error("[supplier destination notify] pending destinations query failed", {
        rfqId,
        error: serializeSupabaseError(error),
      });
      return;
    }

    providerIds = (data ?? [])
      .map((row) => normalizeId(row?.provider_id))
      .filter(Boolean);
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return;
    console.error("[supplier destination notify] pending destinations query crashed", {
      rfqId,
      error: serializeSupabaseError(error) ?? error,
    });
    return;
  }

  const uniqueProviderIds = Array.from(new Set(providerIds));
  if (uniqueProviderIds.length === 0) return;

  const results = await Promise.allSettled(
    uniqueProviderIds.map((providerId) => notifySupplierOfRfqDestination({ rfqId, providerId })),
  );

  const crashed = results.filter((r) => r.status === "rejected");
  if (crashed.length > 0) {
    console.warn("[supplier destination notify] notify crashed (best-effort)", {
      rfqId,
      crashed: crashed.length,
    });
  }
}

