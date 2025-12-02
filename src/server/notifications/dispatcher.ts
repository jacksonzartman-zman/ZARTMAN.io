import { sendNotificationEmail } from "@/server/notifications/email";

export type NotificationAudience = "customer" | "supplier" | "admin" | "internal";
export type NotificationChannel = "email" | "activity" | "webhook";

export type NotificationDispatchContext = {
  eventType: string;
  quoteId?: string | null;
  recipientEmail?: string | null;
  audience?: NotificationAudience;
  channel?: NotificationChannel;
  payload?: Record<string, unknown>;
};

export type DispatchEmailNotificationArgs = NotificationDispatchContext & {
  subject: string;
  previewText?: string;
  html: string;
  skipIfMissingRecipient?: boolean;
};

export async function dispatchNotification(
  context: NotificationDispatchContext,
  deliver: () => Promise<unknown> | unknown,
): Promise<boolean> {
  const logContext = buildLogContext(context);
  console.log("[notifications] dispatch start", logContext);
  try {
    await deliver();
    console.log("[notifications] dispatch success", logContext);
    return true;
  } catch (error) {
    console.error("[notifications] dispatch failed", {
      ...logContext,
      error: serializeError(error),
    });
    return false;
  }
}

export async function dispatchEmailNotification(
  args: DispatchEmailNotificationArgs,
): Promise<boolean> {
  const {
    subject,
    previewText,
    html,
    skipIfMissingRecipient = true,
    ...context
  } = args;
  const recipientEmail = context.recipientEmail ?? null;
  const logContext = buildLogContext({ ...context, recipientEmail });

  if (!recipientEmail && skipIfMissingRecipient) {
    console.warn("[notifications] dispatch skipped", {
      ...logContext,
      reason: "missing-recipient",
    });
    return false;
  }

  return dispatchNotification(
    { ...context, recipientEmail, channel: context.channel ?? "email" },
    () =>
      sendNotificationEmail({
        to: recipientEmail ?? "",
        subject,
        previewText,
        html,
      }),
  );
}

function buildLogContext(context: NotificationDispatchContext) {
  return {
    eventType: context.eventType,
    quoteId: context.quoteId ?? null,
    recipientEmail: context.recipientEmail ?? null,
    audience: context.audience ?? null,
    channel: context.channel ?? null,
    payload: context.payload ?? null,
  };
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  if (error && typeof error === "object") {
    return { ...error };
  }
  return error ?? null;
}
