export type QuoteThreadMessageAuthorRole = "admin" | "customer" | "supplier" | "system" | null;
export type QuoteThreadNeedsReplyRole = "admin" | "customer" | "none";
export type AdminNeedsReplySlaBucket = "<2h" | "<24h" | ">24h" | "none";

export type QuoteThreadNeedsReply = {
  last_message_at: string | null;
  last_message_author_role: QuoteThreadMessageAuthorRole;
  needs_reply_role: QuoteThreadNeedsReplyRole;
  /**
   * Only meaningful when `needs_reply_role === "admin"`.
   */
  sla_bucket: AdminNeedsReplySlaBucket;
};

type MinimalMessage = {
  created_at?: string | null;
  sender_role?: string | null;
  createdAt?: string | null;
  senderRole?: string | null;
};

function normalizeRole(value: unknown): QuoteThreadMessageAuthorRole {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (v === "admin" || v === "customer" || v === "supplier" || v === "system") return v;
  // Back-compat: newer schema sometimes uses "provider" for suppliers.
  if (v === "provider") return "supplier";
  return null;
}

function normalizeIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Number.isNaN(Date.parse(trimmed)) ? null : trimmed;
}

function resolveNowMs(now?: Date | string | number | null): number {
  if (now instanceof Date) return now.getTime();
  if (typeof now === "string" || typeof now === "number") return new Date(now).getTime();
  return Date.now();
}

function resolveNeedsReplyRole(lastRole: QuoteThreadMessageAuthorRole): QuoteThreadNeedsReplyRole {
  if (lastRole === "customer") return "admin";
  if (lastRole === "supplier") return "admin";
  if (lastRole === "admin") return "customer";
  return "none";
}

function resolveAdminSlaBucket(args: {
  needsReplyRole: QuoteThreadNeedsReplyRole;
  lastMessageAt: string | null;
  nowMs: number;
}): AdminNeedsReplySlaBucket {
  if (args.needsReplyRole !== "admin") return "none";
  if (!args.lastMessageAt) return "none";
  const ts = Date.parse(args.lastMessageAt);
  if (!Number.isFinite(ts) || !Number.isFinite(args.nowMs)) return "none";
  const ageMs = args.nowMs - ts;
  const twoHours = 2 * 60 * 60 * 1000;
  const day = 24 * 60 * 60 * 1000;
  if (ageMs < twoHours) return "<2h";
  if (ageMs < day) return "<24h";
  return ">24h";
}

export function computeThreadNeedsReplyFromLastMessage(args: {
  lastMessageAt: string | null;
  lastMessageAuthorRole: QuoteThreadMessageAuthorRole;
  now?: Date | string | number | null;
}): QuoteThreadNeedsReply {
  const nowMs = resolveNowMs(args.now ?? null);
  const lastMessageAt = normalizeIso(args.lastMessageAt);
  const lastRole = args.lastMessageAuthorRole;
  const needsReplyRole = resolveNeedsReplyRole(lastRole);
  const slaBucket = resolveAdminSlaBucket({ needsReplyRole, lastMessageAt, nowMs });

  return {
    last_message_at: lastMessageAt,
    last_message_author_role: lastRole,
    needs_reply_role: needsReplyRole,
    sla_bucket: slaBucket,
  };
}

export function computeThreadNeedsReplyFromMessages(
  messages: MinimalMessage[],
  opts?: { now?: Date | string | number | null },
): QuoteThreadNeedsReply {
  let lastAt: string | null = null;
  let lastRole: QuoteThreadMessageAuthorRole = null;

  for (const msg of Array.isArray(messages) ? messages : []) {
    const createdAt = normalizeIso(msg.created_at ?? msg.createdAt ?? null);
    if (!createdAt) continue;
    if (!lastAt || createdAt > lastAt) {
      lastAt = createdAt;
      lastRole = normalizeRole(msg.sender_role ?? msg.senderRole ?? null);
    }
  }

  return computeThreadNeedsReplyFromLastMessage({
    lastMessageAt: lastAt,
    lastMessageAuthorRole: lastRole,
    now: opts?.now ?? null,
  });
}

