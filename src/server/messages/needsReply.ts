export type NeedsReplySummary = {
  supplierOwesReply: boolean;
  customerOwesReply: boolean;

  supplierReplyOverdue: boolean;
  customerReplyOverdue: boolean;

  slaWindowHours: number;

  lastCustomerMessageAt: string | null;
  lastSupplierMessageAt: string | null;
  /**
   * Latest message timestamp considering only customer/supplier messages.
   */
  lastThreadMessageAt: string | null;
  lastThreadMessageSenderRole: "customer" | "supplier" | null;
};

type MinimalMessage = {
  created_at?: string | null;
  sender_role?: string | null;
  createdAt?: string | null;
  senderRole?: string | null;
};

function normalizeRole(value: unknown): "customer" | "supplier" | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "customer") return "customer";
  if (normalized === "supplier") return "supplier";
  // Defensive: some older records may say "provider" for supplier-like authors.
  if (normalized === "provider") return "supplier";
  return null;
}

function normalizeIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Number.isNaN(Date.parse(trimmed)) ? null : trimmed;
}

function resolveMessageCreatedAt(msg: MinimalMessage): string | null {
  return normalizeIso(msg.created_at ?? msg.createdAt ?? null);
}

function resolveMessageSenderRole(msg: MinimalMessage): "customer" | "supplier" | null {
  return normalizeRole(msg.sender_role ?? msg.senderRole ?? null);
}

function hoursToMs(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return hours * 60 * 60 * 1000;
}

function isOverdue(args: { nowMs: number; lastAt: string | null; windowMs: number }): boolean {
  if (!args.lastAt) return false;
  if (!Number.isFinite(args.nowMs) || args.nowMs <= 0) return false;
  if (!Number.isFinite(args.windowMs) || args.windowMs <= 0) return false;
  const ts = Date.parse(args.lastAt);
  if (!Number.isFinite(ts)) return false;
  return args.nowMs - ts > args.windowMs;
}

export function computeNeedsReplySummary(
  messages: MinimalMessage[],
  opts?: {
    /**
     * SLA window in hours (defaults to 24h).
     */
    slaWindowHours?: number | null;
    /**
     * Override current time for deterministic tests.
     */
    now?: Date | string | number | null;
  },
): NeedsReplySummary {
  const nowMs =
    opts?.now instanceof Date
      ? opts.now.getTime()
      : typeof opts?.now === "string" || typeof opts?.now === "number"
        ? new Date(opts.now).getTime()
        : Date.now();

  const slaWindowHoursRaw = opts?.slaWindowHours;
  const slaWindowHours =
    typeof slaWindowHoursRaw === "number" && Number.isFinite(slaWindowHoursRaw) && slaWindowHoursRaw >= 0
      ? slaWindowHoursRaw
      : 24;
  const slaWindowMs = hoursToMs(slaWindowHours);

  let lastCustomerMessageAt: string | null = null;
  let lastSupplierMessageAt: string | null = null;

  for (const msg of Array.isArray(messages) ? messages : []) {
    const role = resolveMessageSenderRole(msg);
    if (!role) continue;
    const createdAt = resolveMessageCreatedAt(msg);
    if (!createdAt) continue;

    if (role === "customer") {
      if (!lastCustomerMessageAt || createdAt > lastCustomerMessageAt) {
        lastCustomerMessageAt = createdAt;
      }
    } else if (role === "supplier") {
      if (!lastSupplierMessageAt || createdAt > lastSupplierMessageAt) {
        lastSupplierMessageAt = createdAt;
      }
    }
  }

  const supplierOwesReply =
    Boolean(lastCustomerMessageAt) &&
    (!lastSupplierMessageAt || (lastCustomerMessageAt && lastSupplierMessageAt < lastCustomerMessageAt));
  const customerOwesReply =
    Boolean(lastSupplierMessageAt) &&
    (!lastCustomerMessageAt || (lastSupplierMessageAt && lastCustomerMessageAt < lastSupplierMessageAt));

  const lastThreadMessageAt =
    lastCustomerMessageAt && lastSupplierMessageAt
      ? lastCustomerMessageAt >= lastSupplierMessageAt
        ? lastCustomerMessageAt
        : lastSupplierMessageAt
      : lastCustomerMessageAt ?? lastSupplierMessageAt ?? null;

  const lastThreadMessageSenderRole: NeedsReplySummary["lastThreadMessageSenderRole"] =
    !lastThreadMessageAt
      ? null
      : lastCustomerMessageAt === lastThreadMessageAt
        ? "customer"
        : lastSupplierMessageAt === lastThreadMessageAt
          ? "supplier"
          : null;

  return {
    supplierOwesReply,
    customerOwesReply,
    supplierReplyOverdue:
      supplierOwesReply &&
      isOverdue({ nowMs, lastAt: lastCustomerMessageAt, windowMs: slaWindowMs }),
    customerReplyOverdue:
      customerOwesReply &&
      isOverdue({ nowMs, lastAt: lastSupplierMessageAt, windowMs: slaWindowMs }),
    slaWindowHours,
    lastCustomerMessageAt,
    lastSupplierMessageAt,
    lastThreadMessageAt,
    lastThreadMessageSenderRole,
  };
}

