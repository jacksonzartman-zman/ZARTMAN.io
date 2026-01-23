import { supabaseServer } from "@/lib/supabaseServer";
import { serializeSupabaseError } from "@/server/admin/logging";
import type {
  NotificationPreferenceChannel,
  NotificationPreferenceRole,
} from "@/types/notificationPreferences";

type NotificationPreferenceRow = {
  id: string;
  user_id: string;
  role: NotificationPreferenceRole;
  event_type: string;
  channel: NotificationPreferenceChannel;
  enabled: boolean;
};

type ComplianceMode = "standard" | "no_email";

type NotificationSkipReason = "compliance_mode" | "preference_disabled" | "self_recipient";

export type ShouldSendNotificationArgs = {
  recipientUserId?: string | null;
  recipientRole?: NotificationPreferenceRole | "internal" | null;
  actorUserId?: string | null;
  eventType: string;
  channel?: NotificationPreferenceChannel;
  quoteId?: string | null;
};

export type ShouldSendNotificationResult =
  | { allow: true; reason: null }
  | { allow: false; reason: NotificationSkipReason };

const DEFAULT_CHANNEL: NotificationPreferenceChannel = "email";
const complianceModeCache = new Map<string, Promise<ComplianceMode | null>>();
let warnedMissingComplianceModeColumn = false;

function isMissingComplianceModeColumnError(error: unknown): boolean {
  const source = error && typeof error === "object" ? (error as any) : null;
  const code = typeof source?.code === "string" ? (source.code as string) : null;
  const message =
    typeof source?.message === "string" ? (source.message as string) : null;

  if (code === "42703") {
    return true;
  }

  if (!message) {
    return false;
  }

  const normalized = message.toLowerCase();
  return normalized.includes("compliance_mode") && normalized.includes("does not exist");
}

export async function shouldSendNotification(
  args: ShouldSendNotificationArgs,
): Promise<ShouldSendNotificationResult> {
  const channel = args.channel ?? DEFAULT_CHANNEL;
  const normalizedRole = normalizePreferenceRole(args.recipientRole);
  const logContext = {
    eventType: args.eventType,
    quoteId: args.quoteId ?? null,
    recipientRole: normalizedRole,
    recipientUserId: args.recipientUserId ?? null,
    channel,
  };

  if (
    channel === "email" &&
    args.actorUserId &&
    args.recipientUserId &&
    args.actorUserId === args.recipientUserId
  ) {
    console.log("[notifications] gating skip", {
      ...logContext,
      reason: "self_recipient",
    });
    return { allow: false, reason: "self_recipient" };
  }

  if (channel === "email" && args.quoteId) {
    const complianceMode = await loadQuoteComplianceMode(args.quoteId);
    if (complianceMode === "no_email") {
      console.log("[notifications] gating skip", {
        ...logContext,
        reason: "compliance_mode",
        complianceMode,
      });
      return { allow: false, reason: "compliance_mode" };
    }
  }

  if (channel === "email" && normalizedRole && args.recipientUserId) {
    const preference = await loadPreferenceRecord({
      userId: args.recipientUserId,
      role: normalizedRole,
      eventType: args.eventType,
      channel,
    });

    if (preference && preference.enabled === false) {
      console.log("[notifications] gating skip", {
        ...logContext,
        reason: "preference_disabled",
      });
      return { allow: false, reason: "preference_disabled" };
    }
  }

  return { allow: true, reason: null };
}

export async function loadNotificationPreferencesMap(args: {
  userId?: string | null;
  role: NotificationPreferenceRole;
  eventTypes: string[];
  channel?: NotificationPreferenceChannel;
}): Promise<Record<string, boolean>> {
  const channel = args.channel ?? DEFAULT_CHANNEL;
  const defaults: Record<string, boolean> = {};
  args.eventTypes.forEach((eventType) => {
    defaults[eventType] = true;
  });

  if (!args.userId || args.eventTypes.length === 0) {
    return defaults;
  }

  try {
    const { data, error } = await supabaseServer()
      .from("notification_preferences")
      .select("event_type,enabled")
      .eq("user_id", args.userId)
      .eq("role", args.role)
      .eq("channel", channel)
      .in("event_type", args.eventTypes);

    if (error) {
      console.error("[notification prefs] load failed", {
        userId: args.userId,
        role: args.role,
        channel,
        error,
      });
      return defaults;
    }

    if (data) {
      for (const row of data as NotificationPreferenceRow[]) {
        defaults[row.event_type] = row.enabled ?? true;
      }
    }

    return defaults;
  } catch (error) {
    console.error("[notification prefs] load crashed", {
      userId: args.userId,
      role: args.role,
      channel,
      error,
    });
    return defaults;
  }
}

export async function upsertNotificationPreference(args: {
  userId: string;
  role: NotificationPreferenceRole;
  eventType: string;
  channel?: NotificationPreferenceChannel;
  enabled: boolean;
}): Promise<boolean> {
  const channel = args.channel ?? DEFAULT_CHANNEL;
  if (!args.userId) {
    return false;
  }

  try {
    const { error } = await supabaseServer()
      .from("notification_preferences")
      .upsert(
        {
          user_id: args.userId,
          role: args.role,
          event_type: args.eventType,
          channel,
          enabled: args.enabled,
        },
        { onConflict: "user_id,role,event_type,channel" },
      );

    if (error) {
      console.error("[notification prefs] upsert failed", {
        userId: args.userId,
        role: args.role,
        eventType: args.eventType,
        channel,
        error,
      });
      return false;
    }

    return true;
  } catch (error) {
    console.error("[notification prefs] upsert crashed", {
      userId: args.userId,
      role: args.role,
      eventType: args.eventType,
      channel,
      error,
    });
    return false;
  }
}

function normalizePreferenceRole(
  role?: NotificationPreferenceRole | "internal" | null,
): NotificationPreferenceRole | null {
  if (role === "internal") {
    return "admin";
  }
  if (role === "customer" || role === "supplier" || role === "admin") {
    return role;
  }
  return null;
}

async function loadPreferenceRecord(args: {
  userId: string;
  role: NotificationPreferenceRole;
  eventType: string;
  channel: NotificationPreferenceChannel;
}): Promise<NotificationPreferenceRow | null> {
  try {
    const { data, error } = await supabaseServer()
      .from("notification_preferences")
      .select("id,user_id,role,event_type,channel,enabled")
      .eq("user_id", args.userId)
      .eq("role", args.role)
      .eq("event_type", args.eventType)
      .eq("channel", args.channel)
      .maybeSingle<NotificationPreferenceRow>();

    if (error) {
      console.error("[notification prefs] lookup failed", {
        userId: args.userId,
        role: args.role,
        eventType: args.eventType,
        channel: args.channel,
        error,
      });
      return null;
    }

    return data ?? null;
  } catch (error) {
    console.error("[notification prefs] lookup crashed", {
      userId: args.userId,
      role: args.role,
      eventType: args.eventType,
      channel: args.channel,
      error,
    });
    return null;
  }
}

async function loadQuoteComplianceMode(quoteId: string): Promise<ComplianceMode | null> {
  if (!quoteId) {
    return null;
  }

  if (!complianceModeCache.has(quoteId)) {
    complianceModeCache.set(quoteId, fetchQuoteComplianceMode(quoteId));
  }

  return complianceModeCache.get(quoteId) ?? null;
}

async function fetchQuoteComplianceMode(quoteId: string): Promise<ComplianceMode | null> {
  try {
    const { data, error } = await supabaseServer()
      .from("quotes")
      .select("compliance_mode")
      .eq("id", quoteId)
      .maybeSingle<{ compliance_mode: ComplianceMode | null }>();

    if (error) {
      if (isMissingComplianceModeColumnError(error)) {
        if (!warnedMissingComplianceModeColumn) {
          warnedMissingComplianceModeColumn = true;
          console.warn("[notification prefs] compliance_mode missing; defaulting", {
            quoteId,
            error: serializeSupabaseError(error),
          });
        }
        return "standard";
      }

      console.error("[notification prefs] compliance lookup failed", {
        quoteId,
        error: serializeSupabaseError(error),
      });
      return null;
    }

    return data?.compliance_mode ?? "standard";
  } catch (error) {
    console.error("[notification prefs] compliance lookup crashed", {
      quoteId,
      error: serializeSupabaseError(error),
    });
    return null;
  }
}
