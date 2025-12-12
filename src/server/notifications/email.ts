type SendNotificationEmailParams = {
  to: string;
  subject: string;
  previewText?: string;
  html: string;
};

type EmailSendContext = {
  quoteId?: string | null;
  eventType?: string | null;
};

const RESEND_API_URL = "https://api.resend.com/emails";
const RESEND_API_KEY = (process.env.RESEND_API_KEY ?? "").trim();
const RESEND_FROM_EMAIL =
  (process.env.RESEND_FROM_EMAIL ?? "").trim() || "notifications@zartman.io";
const RESEND_FROM_NAME =
  (process.env.RESEND_FROM_NAME ?? "").trim() || "Zartman.io";
const DEFAULT_FROM = `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`;
const IS_PRODUCTION_RUNTIME = isProductionRuntime();

if (IS_PRODUCTION_RUNTIME && !RESEND_API_KEY) {
  throw new Error(
    "[notifications] RESEND_API_KEY is required when running in production.",
  );
}

export async function sendNotificationEmail(
  params: SendNotificationEmailParams,
  context?: EmailSendContext,
): Promise<void> {
  if (!params?.to) {
    console.warn("[notifications] missing recipient email", {
      quoteId: context?.quoteId ?? null,
    });
    return;
  }

  if (!RESEND_API_KEY) {
    console.warn("[notifications] RESEND_API_KEY not configured; email skipped", {
      quoteId: context?.quoteId ?? null,
      eventType: context?.eventType ?? null,
      recipientEmail: params.to,
    });
    return;
  }

  const payload = {
    from: DEFAULT_FROM,
    to: params.to,
    subject: params.subject,
    html: params.previewText
      ? `${buildPreviewSnippet(params.previewText)}${params.html}`
      : params.html,
  };

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const responseBody = await parseJsonBody(response);

    if (!response.ok) {
      console.error("[notifications] email failed", {
        quoteId: context?.quoteId ?? null,
        eventType: context?.eventType ?? null,
        recipientEmail: params.to,
        status: response.status,
        error: responseBody,
      });
      return;
    }

    const messageId = extractResendMessageId(responseBody);
    console.log("[notifications] email sent", {
      quoteId: context?.quoteId ?? null,
      recipientEmail: params.to,
      messageId,
    });
  } catch (error) {
    console.error("[notifications] email failed", {
      quoteId: context?.quoteId ?? null,
      eventType: context?.eventType ?? null,
      recipientEmail: params.to,
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : String(error),
    });
  }
}

function buildPreviewSnippet(copy: string) {
  return `<div style="display:none;font-size:1px;color:#fefefe;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${copy}</div>`;
}

function extractResendMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const id = (payload as { id?: string }).id;
  if (typeof id === "string" && id.length > 0) {
    return id;
  }
  const data = (payload as { data?: { id?: string } }).data;
  if (data?.id && typeof data.id === "string") {
    return data.id;
  }
  return null;
}

async function parseJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isProductionRuntime(): boolean {
  if (process.env.VERCEL_ENV) {
    return process.env.VERCEL_ENV === "production";
  }
  return process.env.NODE_ENV === "production";
}
