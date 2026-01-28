import { supabaseServer } from "@/lib/supabaseServer";
import { dispatchEmailNotification } from "@/server/notifications/dispatcher";
import { serializeSupabaseError } from "@/server/admin/logging";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function buildPortalLink(path: string) {
  return `${SITE_URL}${path}`;
}

type QuoteNotificationRow = { id: string; email: string };

/**
 * Sends opt-in email notifications when the first offer arrives on an RFQ.
 * This is used by the public `/rfq` page "Notify me when offers arrive" panel.
 *
 * Best-effort:
 * - If the table/schema is missing or email is not configured, we fail soft.
 * - After attempting notification, we clear subscriptions for the quote to avoid repeat sends.
 */
export async function notifyQuoteSubscribersFirstOfferArrived(args: {
  quoteId: string;
  offerId: string;
}): Promise<void> {
  const quoteId = normalizeId(args.quoteId);
  const offerId = normalizeId(args.offerId);
  if (!quoteId || !offerId) return;

  let rows: QuoteNotificationRow[] = [];
  try {
    const { data, error } = await supabaseServer()
      .from("quote_notifications")
      .select("id,email")
      .eq("quote_id", quoteId)
      .limit(200)
      .returns<QuoteNotificationRow[]>();

    if (error) {
      console.warn("[offer arrival] quote_notifications load failed", {
        quoteId,
        error: serializeSupabaseError(error),
      });
      return;
    }
    rows = Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn("[offer arrival] quote_notifications load crashed", {
      quoteId,
      error: serializeSupabaseError(error) ?? error,
    });
    return;
  }

  const emails = Array.from(
    new Set(rows.map((r) => normalizeEmail(r.email)).filter(Boolean) as string[]),
  );
  if (emails.length === 0) return;

  const customerLink = buildPortalLink(`/customer/quotes/${quoteId}`);
  const subject = "Offers have arrived for your RFQ";
  const previewText = "Your first offer is in—sign in to review it.";
  const html = `
    <p>Your first offer has arrived for your RFQ.</p>
    <p><a href="${customerLink}">Open your workspace</a> to review pricing and lead time.</p>
    <p style="margin-top:12px;color:#64748b;font-size:12px;">
      If you don’t have an account yet, sign in or create one with this email to claim your quote.
    </p>
  `;

  await Promise.allSettled(
    emails.map((email) =>
      dispatchEmailNotification({
        eventType: "rfq_offer_arrived",
        quoteId,
        recipientEmail: email,
        recipientRole: "customer",
        audience: "customer",
        payload: { offerId },
        subject,
        previewText,
        html,
      }),
    ),
  );

  // Prevent repeat sends for subsequent offers.
  try {
    const { error } = await supabaseServer()
      .from("quote_notifications")
      .delete()
      .eq("quote_id", quoteId);
    if (error) {
      console.warn("[offer arrival] quote_notifications cleanup failed", {
        quoteId,
        error: serializeSupabaseError(error),
      });
    }
  } catch (error) {
    console.warn("[offer arrival] quote_notifications cleanup crashed", {
      quoteId,
      error: serializeSupabaseError(error) ?? error,
    });
  }
}

