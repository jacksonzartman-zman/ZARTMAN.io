import { supabaseServer } from "@/lib/supabaseServer";
import { dispatchEmailNotification } from "@/server/notifications/dispatcher";
import { serializeSupabaseError } from "@/server/admin/logging";
import { hasColumns } from "@/server/db/schemaContract";

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

type QuoteUploadRow = {
  id: string;
  upload_id: string | null;
};

type UploadIntakeKeyRow = {
  id: string;
  intake_idempotency_key: string | null;
};

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

  // Load the public RFQ link key (upload intake idempotency key).
  // This is the key required by `/rfq?quote=...&key=...`.
  let intakeKey: string | null = null;
  try {
    const quoteRes = await supabaseServer()
      .from("quotes")
      .select("id,upload_id")
      .eq("id", quoteId)
      .maybeSingle<QuoteUploadRow>();

    if (quoteRes.error) {
      console.warn("[offer arrival] quote load failed (best-effort)", {
        quoteId,
        error: serializeSupabaseError(quoteRes.error),
      });
    } else {
      const uploadId = normalizeId(quoteRes.data?.upload_id);
      if (uploadId) {
        const uploadRes = await supabaseServer()
          .from("uploads")
          .select("id,intake_idempotency_key")
          .eq("id", uploadId)
          .maybeSingle<UploadIntakeKeyRow>();

        if (uploadRes.error) {
          console.warn("[offer arrival] upload intake key load failed (best-effort)", {
            quoteId,
            uploadId,
            error: serializeSupabaseError(uploadRes.error),
          });
        } else {
          const key = normalizeId(uploadRes.data?.intake_idempotency_key);
          intakeKey = key || null;
        }
      }
    }
  } catch (error) {
    console.warn("[offer arrival] public link key lookup crashed (best-effort)", {
      quoteId,
      error: serializeSupabaseError(error) ?? error,
    });
  }

  if (!intakeKey) {
    // Without the public key we cannot construct the required link.
    console.warn("[offer arrival] missing intake key; skipping offer-arrival notify (best-effort)", {
      quoteId,
      offerId,
    });
    return;
  }

  const supportsSentAt = await (async () => {
    try {
      return await hasColumns("quote_notifications", ["sent_at"]);
    } catch {
      return false;
    }
  })();

  // Atomically claim any unsent subscribers for this quote to prevent duplicate sends
  // if multiple offers land concurrently.
  let claimed: QuoteNotificationRow[] = [];
  try {
    if (supportsSentAt) {
      const { data, error } = await supabaseServer()
        .from("quote_notifications")
        .update({ sent_at: new Date().toISOString() })
        .eq("quote_id", quoteId)
        .is("sent_at", null)
        .select("id,email")
        .limit(200)
        .returns<QuoteNotificationRow[]>();

      if (error) {
        console.warn("[offer arrival] quote_notifications claim failed", {
          quoteId,
          error: serializeSupabaseError(error),
        });
        return;
      }
      claimed = Array.isArray(data) ? data : [];
    } else {
      // Older schema fallback: read rows and then delete them to prevent repeat sends.
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

      claimed = Array.isArray(data) ? data : [];

      // Best-effort: prevent repeat sends for subsequent offers.
      // (Not an ideal replacement for sent_at, but avoids spamming when schema is older.)
      if (claimed.length > 0) {
        try {
          await supabaseServer().from("quote_notifications").delete().eq("quote_id", quoteId);
        } catch {
          // ignore
        }
      }
    }
  } catch (error) {
    console.warn("[offer arrival] quote_notifications claim/load crashed", {
      quoteId,
      error: serializeSupabaseError(error) ?? error,
    });
    return;
  }

  const emails = Array.from(
    new Set(claimed.map((r) => normalizeEmail(r.email)).filter(Boolean) as string[]),
  );
  if (emails.length === 0) return;

  const rfqLink = buildPortalLink(
    `/rfq?quote=${encodeURIComponent(quoteId)}&key=${encodeURIComponent(intakeKey)}`,
  );

  const subject = "Your manufacturing offer is ready";
  const previewText = "Open your RFQ to review your first offer.";
  const html = `
    <p>Your manufacturing offer is ready.</p>
    <p><a href="${rfqLink}">View your offer</a></p>
  `;

  const results = await Promise.allSettled(
    emails.map(async (email) => {
      const ok = await dispatchEmailNotification({
        eventType: "rfq_offer_arrival_opt_in",
        quoteId,
        recipientEmail: email,
        recipientRole: "customer",
        audience: "customer",
        payload: { offerId },
        subject,
        previewText,
        html,
      });

      if (ok) {
        console.log("[notifications] sent offer arrival email", { quoteId, email });
      }
    }),
  );

  // Surface unexpected failures (deliver() should be non-throwing, but keep best-effort observability).
  const crashed = results.filter((r) => r.status === "rejected");
  if (crashed.length > 0) {
    console.warn("[offer arrival] notify crashed (best-effort)", {
      quoteId,
      crashed: crashed.length,
    });
  }
}

