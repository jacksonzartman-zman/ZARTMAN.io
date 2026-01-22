type SendNotificationEmailParams = {
  to: string;
  subject: string;
  previewText?: string;
  html: string;
  /**
   * Optional Reply-To address (e.g. email-bridge token address).
   * When omitted, replies go to the From address.
   */
  replyTo?: string;
};

const RESEND_API_URL = "https://api.resend.com/emails";
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DEFAULT_FROM =
  process.env.NOTIFICATIONS_FROM_EMAIL ?? "Zartman <notifications@zartman.io>";

export async function sendNotificationEmail(
  params: SendNotificationEmailParams,
): Promise<void> {
  if (!params?.to) {
    console.warn("[notifications] missing recipient email", {
      subject: params?.subject ?? null,
    });
    return;
  }

  if (!RESEND_API_KEY) {
    console.warn("[notifications] RESEND_API_KEY not configured; email skipped", {
      to: params.to,
      subject: params.subject,
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
    ...(params.replyTo ? { reply_to: params.replyTo } : {}),
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

    if (!response.ok) {
      const errorPayload = await readErrorResponse(response);
      console.error("[notifications] email send failed", {
        to: params.to,
        subject: params.subject,
        status: response.status,
        error: errorPayload,
      });
    }
  } catch (error) {
    console.error("[notifications] email send crashed", {
      to: params.to,
      subject: params.subject,
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

async function readErrorResponse(response: Response) {
  try {
    return await response.json();
  } catch {
    return { statusText: response.statusText };
  }
}
