import { sendNotificationEmail } from "@/server/notifications/email";
import {
  shouldSendNotification,
  type ShouldSendNotificationResult,
} from "@/server/notifications/preferences";
import type { NotificationPreferenceRole } from "@/types/notificationPreferences";

export type NotificationAudience = "customer" | "supplier" | "admin" | "internal";
export type NotificationChannel = "email" | "activity" | "webhook";

export type NotificationDispatchContext = {
  eventType: string;
  quoteId?: string | null;
  recipientEmail?: string | null;
  recipientUserId?: string | null;
  recipientRole?: NotificationPreferenceRole | "internal" | null;
  actorRole?: NotificationPreferenceRole | "system" | null;
  actorUserId?: string | null;
  audience?: NotificationAudience;
  channel?: NotificationChannel;
  payload?: Record<string, unknown>;
};

export type DispatchEmailNotificationArgs = NotificationDispatchContext & {
  subject: string;
  previewText?: string;
  html: string;
  replyTo?: string;
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
    replyTo,
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

  const channel = context.channel ?? "email";
  let gateResult: ShouldSendNotificationResult = { allow: true, reason: null };

  if (channel === "email") {
    gateResult = await shouldSendNotification({
      eventType: context.eventType,
      quoteId: context.quoteId,
      channel: "email",
      recipientRole: resolveRecipientRole(context),
      recipientUserId: context.recipientUserId,
      actorUserId: context.actorUserId,
    });
  }

  if (!gateResult.allow) {
    logSkippedDispatch(logContext, gateResult);
    return false;
  }

  return dispatchNotification(
    { ...context, recipientEmail, channel },
    () =>
      sendNotificationEmail({
        to: recipientEmail ?? "",
        subject,
        previewText,
        html,
        replyTo,
      }),
  );
}

function buildLogContext(context: NotificationDispatchContext) {
  return {
    eventType: context.eventType,
    quoteId: context.quoteId ?? null,
    recipientEmail: context.recipientEmail ?? null,
    recipientUserId: context.recipientUserId ?? null,
    recipientRole: context.recipientRole ?? null,
    actorRole: context.actorRole ?? null,
    actorUserId: context.actorUserId ?? null,
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

function resolveRecipientRole(
  context: NotificationDispatchContext,
): NotificationPreferenceRole | null {
  if (context.recipientRole && context.recipientRole !== "internal") {
    return context.recipientRole;
  }
  if (context.recipientRole === "internal") {
    return "admin";
  }
  if (
    context.audience === "customer" ||
    context.audience === "supplier" ||
    context.audience === "admin"
  ) {
    return context.audience;
  }
  if (context.audience === "internal") {
    return "admin";
  }
  return null;
}

function logSkippedDispatch(
  logContext: ReturnType<typeof buildLogContext>,
  result: ShouldSendNotificationResult,
) {
  console.log("[notifications] dispatch start", logContext);
  const reason =
    result.reason === "compliance_mode"
      ? "skipped due to compliance_mode"
      : result.reason === "preference_disabled"
        ? "skipped due to notification_preferences"
        : "skipped (self_recipient)";
  console.warn("[notifications] dispatch skipped", {
    ...logContext,
    reason,
    skipReason: result.reason,
  });
}
