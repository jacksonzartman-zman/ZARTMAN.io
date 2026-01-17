import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";
import { schemaGate } from "@/server/db/schemaContract";
import { handleMissingSupabaseSchema, isSupabaseRelationMarkedMissing } from "@/server/db/schemaErrors";
import { getEmailOutboundStatus } from "@/server/quotes/emailOutbound";
import {
  isEmailInboundEnabled,
  isEmailOutboundEnabled,
  isGenericInboundEnabled,
  isPortalEmailSendEnabledFlag,
  isPostmarkInboundBasicAuthConfigured,
  readEmailInboundEnabledEnv,
  readEmailOutboundEnabledEnv,
  readPortalEmailSendEnabledEnv,
} from "@/server/quotes/emailOpsFlags";
import { isCustomerEmailBridgeEnabled } from "@/server/quotes/customerEmailPrefs";
import { isSupplierMismatchLogsEnabled } from "@/server/admin/supplierMismatchSummary";

type EmailDirection = "inbound" | "outbound";

export type EmailOpsConfigSummary = {
  outbound: {
    emailOutboundEnabledEnv: boolean | null;
    emailOutboundEnabledEffective: boolean;
    status: ReturnType<typeof getEmailOutboundStatus>;
  };
  inbound: {
    emailInboundEnabledEnv: boolean | null;
    emailInboundEnabled: boolean;
    genericEndpointEnabled: boolean;
    postmarkBasicAuthConfigured: boolean;
    endpoints: Array<{ path: string; enabled: boolean; note?: string | null }>;
  };
  portalSendViaEmail: {
    portalEmailSendEnabledEnv: boolean | null;
    portalEmailSendEnabledEffective: boolean;
  };
  customerEmailBridge: {
    enabledEnv: boolean;
  };
  supplierMismatchLogs: {
    enabledEnv: boolean;
  };
  attachments: {
    mode: "best_effort";
    bucket: string;
  };
};

export type EmailOpsActivityRow = {
  createdAt: string;
  quoteId: string;
  direction: EmailDirection;
  actorRole: string;
  attachmentsCount: number;
};

export type EmailOpsActivityResult =
  | { ok: true; supported: true; rows: EmailOpsActivityRow[] }
  | { ok: true; supported: false; reason: "unsupported_schema" }
  | { ok: false; supported: false; reason: "unknown" };

export type EmailOpsCounters = {
  supported: boolean;
  windowHours: number;
  limit: number;
  isLowerBound: boolean;
  inbound: number;
  outbound: number;
  withAttachments: number;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readMetaRecord(meta: unknown): Record<string, unknown> | null {
  if (!meta || typeof meta !== "object") return null;
  return meta as Record<string, unknown>;
}

function isEmailMeta(meta: unknown): boolean {
  const record = readMetaRecord(meta);
  if (!record) return false;
  const via = normalizeString(record.via).toLowerCase();
  return via.includes("email");
}

function readOutboundFlag(meta: unknown): boolean | null {
  const record = readMetaRecord(meta);
  if (!record) return null;
  const raw = record.outbound;
  return typeof raw === "boolean" ? raw : null;
}

function readSenderRole(meta: unknown, senderRoleFallback: unknown): string {
  const record = readMetaRecord(meta);
  const fromMeta = normalizeString(record?.senderRole).toLowerCase();
  if (fromMeta) return fromMeta;
  return normalizeString(senderRoleFallback).toLowerCase() || "unknown";
}

function readAttachmentsCount(meta: unknown): number {
  const record = readMetaRecord(meta);
  if (!record) return 0;
  const raw = record.attachments;
  if (!Array.isArray(raw)) return 0;
  return raw.length;
}

function directionFromMeta(meta: unknown): EmailDirection {
  const outbound = readOutboundFlag(meta);
  return outbound === true ? "outbound" : "inbound";
}

export async function loadEmailOpsConfigSummary(): Promise<EmailOpsConfigSummary> {
  await requireAdminUser();

  const outboundStatus = getEmailOutboundStatus();
  const postmarkBasicAuthConfigured = isPostmarkInboundBasicAuthConfigured();
  const emailInboundEnabled = isEmailInboundEnabled();
  const genericEndpointEnabled = isGenericInboundEnabled();

  const endpoints = [
    {
      path: "/api/inbound/postmark",
      enabled: emailInboundEnabled && postmarkBasicAuthConfigured,
      note: postmarkBasicAuthConfigured ? null : "Requires Postmark inbound basic auth env vars.",
    },
    {
      path: "/api/inbound/email",
      enabled: genericEndpointEnabled,
      note: "Generic inbound has no provider auth; keep disabled unless explicitly needed.",
    },
  ];

  return {
    outbound: {
      emailOutboundEnabledEnv: readEmailOutboundEnabledEnv(),
      emailOutboundEnabledEffective: isEmailOutboundEnabled(),
      status: outboundStatus,
    },
    inbound: {
      emailInboundEnabledEnv: readEmailInboundEnabledEnv(),
      emailInboundEnabled,
      genericEndpointEnabled,
      postmarkBasicAuthConfigured,
      endpoints,
    },
    portalSendViaEmail: {
      portalEmailSendEnabledEnv: readPortalEmailSendEnabledEnv(),
      portalEmailSendEnabledEffective: isPortalEmailSendEnabledFlag(),
    },
    customerEmailBridge: {
      enabledEnv: isCustomerEmailBridgeEnabled(),
    },
    supplierMismatchLogs: {
      enabledEnv: isSupplierMismatchLogsEnabled(),
    },
    attachments: {
      mode: "best_effort",
      bucket: "cad_uploads",
    },
  };
}

export async function loadEmailOpsRecentActivity(): Promise<EmailOpsActivityResult> {
  await requireAdminUser();

  const RELATION = "quote_messages";
  if (isSupabaseRelationMarkedMissing(RELATION)) {
    return { ok: true, supported: false, reason: "unsupported_schema" };
  }

  const supported = await schemaGate({
    enabled: true,
    relation: RELATION,
    requiredColumns: ["quote_id", "sender_role", "created_at", "metadata"],
    warnPrefix: "[email_ops]",
    warnKey: "email_ops:quote_messages_activity",
  });
  if (!supported) {
    return { ok: true, supported: false, reason: "unsupported_schema" };
  }

  try {
    const { data, error } = await supabaseServer
      .from(RELATION)
      .select("quote_id,sender_role,created_at,metadata")
      .order("created_at", { ascending: false })
      // Bounded scan: filter in-memory to avoid JSONB filter drift.
      .limit(500);

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: RELATION,
          error,
          warnPrefix: "[email_ops]",
          warnKey: "email_ops:quote_messages_activity_missing_schema",
        })
      ) {
        return { ok: true, supported: false, reason: "unsupported_schema" };
      }
      return { ok: false, supported: false, reason: "unknown" };
    }

    const rows = Array.isArray(data) ? (data as any[]) : [];
    const out: EmailOpsActivityRow[] = [];

    for (const row of rows) {
      const meta = row?.metadata ?? null;
      if (!isEmailMeta(meta)) continue;

      const quoteId = normalizeString(row?.quote_id);
      const createdAt = normalizeString(row?.created_at);
      if (!quoteId || !createdAt) continue;

      out.push({
        quoteId,
        createdAt,
        direction: directionFromMeta(meta),
        actorRole: readSenderRole(meta, row?.sender_role),
        attachmentsCount: readAttachmentsCount(meta),
      });

      if (out.length >= 50) break;
    }

    return { ok: true, supported: true, rows: out };
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: RELATION,
        error,
        warnPrefix: "[email_ops]",
        warnKey: "email_ops:quote_messages_activity_missing_schema_crash",
      })
    ) {
      return { ok: true, supported: false, reason: "unsupported_schema" };
    }
    return { ok: false, supported: false, reason: "unknown" };
  }
}

export async function loadEmailOpsCounters(): Promise<EmailOpsCounters> {
  await requireAdminUser();

  const RELATION = "quote_messages";
  const windowHours = 24;
  const limit = 1000;

  if (isSupabaseRelationMarkedMissing(RELATION)) {
    return { supported: false, windowHours, limit, isLowerBound: false, inbound: 0, outbound: 0, withAttachments: 0 };
  }

  const supported = await schemaGate({
    enabled: true,
    relation: RELATION,
    requiredColumns: ["created_at", "metadata"],
    warnPrefix: "[email_ops]",
    warnKey: "email_ops:quote_messages_counters",
  });
  if (!supported) {
    return { supported: false, windowHours, limit, isLowerBound: false, inbound: 0, outbound: 0, withAttachments: 0 };
  }

  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  try {
    const { data, error } = await supabaseServer
      .from(RELATION)
      .select("created_at,metadata")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      if (
        handleMissingSupabaseSchema({
          relation: RELATION,
          error,
          warnPrefix: "[email_ops]",
          warnKey: "email_ops:quote_messages_counters_missing_schema",
        })
      ) {
        return { supported: false, windowHours, limit, isLowerBound: false, inbound: 0, outbound: 0, withAttachments: 0 };
      }
      return { supported: false, windowHours, limit, isLowerBound: false, inbound: 0, outbound: 0, withAttachments: 0 };
    }

    const rows = Array.isArray(data) ? (data as any[]) : [];
    let inbound = 0;
    let outbound = 0;
    let withAttachments = 0;

    for (const row of rows) {
      const meta = row?.metadata ?? null;
      if (!isEmailMeta(meta)) continue;
      const dir = directionFromMeta(meta);
      if (dir === "outbound") outbound += 1;
      else inbound += 1;
      if (readAttachmentsCount(meta) > 0) withAttachments += 1;
    }

    return {
      supported: true,
      windowHours,
      limit,
      isLowerBound: rows.length >= limit,
      inbound,
      outbound,
      withAttachments,
    };
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: RELATION,
        error,
        warnPrefix: "[email_ops]",
        warnKey: "email_ops:quote_messages_counters_missing_schema_crash",
      })
    ) {
      return { supported: false, windowHours, limit, isLowerBound: false, inbound: 0, outbound: 0, withAttachments: 0 };
    }
    return { supported: false, windowHours, limit, isLowerBound: false, inbound: 0, outbound: 0, withAttachments: 0 };
  }
}

