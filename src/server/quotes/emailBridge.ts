import crypto from "node:crypto";

import { supabaseServer } from "@/lib/supabaseServer";
import { schemaGate } from "@/server/db/schemaContract";
import { isMissingTableOrColumnError, serializeSupabaseError, warnOnce } from "@/server/db/schemaErrors";
import { isCustomerEmailOptedIn } from "@/server/quotes/customerEmailPrefs";

export type InboundEmailAttachment = {
  name: string;
  contentType: string | null;
  contentLength: number | null;
  /**
   * Provider-specific availability.
   * - Postmark inbound includes base64 content
   * - Other providers may omit this field
   */
  contentBase64?: string;
};

export type InboundEmail = {
  /**
   * Provider source (best-effort).
   * - postmark: `src/app/api/inbound/postmark/route.ts`
   * - generic: `src/app/api/inbound/email/route.ts`
   */
  provider?: "postmark" | "generic";
  /**
   * Provider-specific message id for deterministic dedupe + threading.
   * - Postmark inbound: payload.MessageID
   */
  providerMessageId?: string | null;
  from: string;
  to: string[];
  cc?: string[];
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  date?: string | null;
  /**
   * Legacy / provider-agnostic message id (kept for compatibility).
   * Prefer `providerMessageId` when present.
   */
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string[] | null;
  attachments?: InboundEmailAttachment[];
};

type ReplyTokenParts = {
  quoteId: string;
  partyId: string;
  sig: string;
};

const WARN_PREFIX = "[email_bridge]";
const QUOTE_MESSAGES_RELATION = "quote_messages";
const EMAIL_ATTACHMENTS_BUCKET = "cad_uploads";

// Keep the local-part token reasonably short for common provider limits.
const SIG_HEX_LEN = 16; // 8 bytes -> 16 hex chars
type ReplyTokenScope = "supplier" | "customer";

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isSafeTokenComponent(value: string): boolean {
  // UUIDs + common ids; keep conservative to avoid weird parsing/abuse.
  return /^[a-zA-Z0-9-]{6,}$/.test(value);
}

function safeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function computeSigHexLegacySupplier(args: { secret: string; quoteId: string; supplierId: string }): string {
  const hmac = crypto
    .createHmac("sha256", args.secret)
    .update(`${args.quoteId}:${args.supplierId}`, "utf8")
    .digest("hex");
  return hmac.slice(0, SIG_HEX_LEN);
}

function computeSigHexScoped(args: {
  secret: string;
  scope: ReplyTokenScope;
  quoteId: string;
  partyId: string;
}): string {
  const hmac = crypto
    .createHmac("sha256", args.secret)
    .update(`${args.scope}:${args.quoteId}:${args.partyId}`, "utf8")
    .digest("hex");
  return hmac.slice(0, SIG_HEX_LEN);
}

export function createReplyToken(args: { quoteId: string; supplierId: string; secret?: string }): string | null {
  const quoteId = normalizeString(args.quoteId);
  const supplierId = normalizeString(args.supplierId);
  const secret = normalizeString(args.secret ?? process.env.EMAIL_BRIDGE_SECRET);

  if (!secret) return null;
  if (!quoteId || !supplierId) return null;
  if (!isSafeTokenComponent(quoteId) || !isSafeTokenComponent(supplierId)) return null;

  // New scoped tokens (supplier:<quoteId>:<supplierId>); verify maintains back-compat.
  const sig = computeSigHexScoped({ secret, scope: "supplier", quoteId, partyId: supplierId });
  return `${quoteId}.${supplierId}.${sig}`;
}

export function verifyReplyToken(args: { quoteId: string; supplierId: string; sig: string; secret?: string }): boolean {
  const quoteId = normalizeString(args.quoteId);
  const supplierId = normalizeString(args.supplierId);
  const sig = normalizeString(args.sig).toLowerCase();
  const secret = normalizeString(args.secret ?? process.env.EMAIL_BRIDGE_SECRET);

  if (!secret) return false;
  if (!quoteId || !supplierId || !sig) return false;
  if (!isSafeTokenComponent(quoteId) || !isSafeTokenComponent(supplierId)) return false;
  if (!/^[a-f0-9]{8,64}$/.test(sig)) return false;

  // Backward compatibility: accept both scoped and legacy tokens.
  const expectedScoped = computeSigHexScoped({ secret, scope: "supplier", quoteId, partyId: supplierId }).toLowerCase();
  if (safeEquals(expectedScoped, sig)) return true;

  const expectedLegacy = computeSigHexLegacySupplier({ secret, quoteId, supplierId }).toLowerCase();
  return safeEquals(expectedLegacy, sig);
}

export function createCustomerReplyToken(args: {
  quoteId: string;
  customerId: string;
  secret?: string;
}): string | null {
  const quoteId = normalizeString(args.quoteId);
  const customerId = normalizeString(args.customerId);
  const secret = normalizeString(args.secret ?? process.env.EMAIL_BRIDGE_SECRET);
  if (!secret) return null;
  if (!quoteId || !customerId) return null;
  if (!isSafeTokenComponent(quoteId) || !isSafeTokenComponent(customerId)) return null;

  const sig = computeSigHexScoped({ secret, scope: "customer", quoteId, partyId: customerId });
  return `${quoteId}.${customerId}.${sig}`;
}

export function verifyCustomerReplyToken(args: {
  quoteId: string;
  customerId: string;
  sig: string;
  secret?: string;
}): boolean {
  const quoteId = normalizeString(args.quoteId);
  const customerId = normalizeString(args.customerId);
  const sig = normalizeString(args.sig).toLowerCase();
  const secret = normalizeString(args.secret ?? process.env.EMAIL_BRIDGE_SECRET);

  if (!secret) return false;
  if (!quoteId || !customerId || !sig) return false;
  if (!isSafeTokenComponent(quoteId) || !isSafeTokenComponent(customerId)) return false;
  if (!/^[a-f0-9]{8,64}$/.test(sig)) return false;

  const expected = computeSigHexScoped({ secret, scope: "customer", quoteId, partyId: customerId }).toLowerCase();
  return safeEquals(expected, sig);
}

function getEmailBridgeDomain(): string | null {
  const explicit = normalizeString(process.env.EMAIL_BRIDGE_DOMAIN);
  if (explicit) return explicit;

  const siteUrl =
    normalizeString(process.env.NEXT_PUBLIC_SITE_URL) ||
    (normalizeString(process.env.VERCEL_URL) ? `https://${normalizeString(process.env.VERCEL_URL)}` : "");

  if (!siteUrl) return null;

  try {
    const url = new URL(siteUrl);
    const host = url.hostname.trim();
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

export function getSupplierReplyToAddress(args: {
  quoteId: string;
  supplierId: string;
}): { ok: true; address: string } | { ok: false; reason: "disabled" | "missing_domain" } {
  const secret = normalizeString(process.env.EMAIL_BRIDGE_SECRET);
  if (!secret) {
    return { ok: false, reason: "disabled" };
  }

  const domain = getEmailBridgeDomain();
  if (!domain) {
    return { ok: false, reason: "missing_domain" };
  }

  const token = createReplyToken({ quoteId: args.quoteId, supplierId: args.supplierId, secret });
  if (!token) {
    return { ok: false, reason: "disabled" };
  }

  return { ok: true, address: `reply+${token}@${domain}` };
}

function tryExtractEmail(raw: string): string | null {
  const trimmed = normalizeString(raw);
  if (!trimmed) return null;

  // Common formats: "Name <email@domain>", "email@domain"
  const angleMatch = trimmed.match(/<([^>]+@[^>]+)>/);
  const candidate = angleMatch ? angleMatch[1] : trimmed;
  const cleaned = candidate.replace(/[,\s]+$/g, "").trim();
  return cleaned.includes("@") ? cleaned : null;
}

function normalizeEmailForCompare(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const extracted = tryExtractEmail(raw);
  if (!extracted) return null;
  const trimmed = extracted.trim().toLowerCase();
  if (!trimmed) return null;
  // Conservative: avoid accepting obviously non-email values.
  if (!trimmed.includes("@") || trimmed.includes(" ") || trimmed.length > 320) return null;
  return trimmed;
}

function parseCsvEnvList(value: unknown): string[] {
  const raw = normalizeString(value);
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isInternalInboundSender(inboundFrom: unknown): boolean {
  const from = normalizeEmailForCompare(inboundFrom);
  if (!from) return false;

  const emailFrom = normalizeEmailForCompare(process.env.EMAIL_FROM ?? "");
  if (emailFrom && from === emailFrom) {
    return true;
  }

  // Optional allowlist for "internal sender" suppression (comma-separated).
  // Intentionally flexible naming to reduce config friction.
  const allowlist = [
    ...parseCsvEnvList(process.env.EMAIL_INTERNAL_SENDER_ALLOWLIST),
    ...parseCsvEnvList(process.env.EMAIL_INTERNAL_SENDERS),
  ]
    .map((v) => normalizeEmailForCompare(v))
    .filter(Boolean) as string[];

  return allowlist.some((a) => a === from);
}

export function parseReplyToTokenFromRecipients(
  recipients: string[],
): { ok: true; parts: ReplyTokenParts } | { ok: false; reason: "missing" | "malformed" } {
  const list = Array.isArray(recipients) ? recipients : [];
  for (const raw of list) {
    const email = raw ? tryExtractEmail(raw) : null;
    if (!email) continue;

    const at = email.lastIndexOf("@");
    if (at <= 0) continue;

    const local = email.slice(0, at);
    if (!local.toLowerCase().startsWith("reply+")) continue;

    const token = local.slice("reply+".length);
    const [quoteId, partyId, sig, ...rest] = token.split(".");
    if (rest.length > 0) return { ok: false, reason: "malformed" };

    const q = normalizeString(quoteId);
    const s = normalizeString(partyId);
    const g = normalizeString(sig);
    if (!q || !s || !g) return { ok: false, reason: "malformed" };
    if (!isSafeTokenComponent(q) || !isSafeTokenComponent(s)) return { ok: false, reason: "malformed" };

    return { ok: true, parts: { quoteId: q, partyId: s, sig: g } };
  }
  return { ok: false, reason: "missing" };
}

function stripHtmlToText(html: string): string {
  const input = typeof html === "string" ? html : "";
  if (!input.trim()) return "";

  // Minimal/fast: remove scripts/styles, convert <br>/<p> to newlines, strip tags.
  const withoutScripts = input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ");
  const withNewlines = withoutScripts
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*p\s*>/gi, "\n")
    .replace(/<\/\s*div\s*>/gi, "\n");
  const stripped = withNewlines.replace(/<[^>]+>/g, " ");
  return stripped
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeBody(inbound: InboundEmail): string | null {
  const text = normalizeString(inbound.text);
  if (text) return text.length > 2000 ? text.slice(0, 2000) : text;

  const html = normalizeString(inbound.html);
  if (!html) return null;

  const stripped = stripHtmlToText(html);
  if (!stripped) return null;
  return stripped.length > 2000 ? stripped.slice(0, 2000) : stripped;
}

type StoredInboundAttachment = {
  filename: string;
  storageBucketId: string;
  storagePath: string;
  sizeBytes: number | null;
  mime: string | null;
  /**
   * Populated when we can also create canonical file rows (files_valid/files).
   * Used only for UX; never required.
   */
  quoteFileId?: string | null;
};

function sanitizeAttachmentFileName(input: unknown): string {
  const raw = typeof input === "string" ? input.trim() : "";
  // Strip any directory components (avoid traversal / weird provider values).
  const basename = raw.replace(/\\/g, "/").split("/").filter(Boolean).slice(-1)[0] ?? "";
  const normalized = basename
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .trim();

  const clipped = normalized.slice(0, 120);
  return clipped || "attachment";
}

function isoDateStamp(): string {
  const d = new Date();
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function buildEmailAttachmentStoragePath(args: {
  quoteId: string;
  role: "supplier" | "customer";
  filename: string;
}): string {
  const qid = normalizeString(args.quoteId) || "unknown-quote";
  const role = args.role;
  const date = isoDateStamp();
  const random = crypto.randomBytes(8).toString("hex");
  const safeName = sanitizeAttachmentFileName(args.filename);
  // Preferred prefix (new): uploads/email/<quoteId>/<role>/<yyyy-mm-dd>/<random>/<filename>
  return `uploads/email/${qid}/${role}/${date}/${random}/${safeName}`;
}

async function uploadInboundEmailAttachments(args: {
  quoteId: string;
  role: "supplier" | "customer";
  attachments: InboundEmailAttachment[];
}): Promise<{
  ok: boolean;
  stored: StoredInboundAttachment[];
  storageUnavailable?: boolean;
}> {
  const quoteId = normalizeString(args.quoteId);
  const role = args.role;
  const attachments = Array.isArray(args.attachments) ? args.attachments : [];
  if (!quoteId) return { ok: false, stored: [] };
  if (attachments.length === 0) return { ok: true, stored: [] };

  const stored: StoredInboundAttachment[] = [];

  for (const [index, attachment] of attachments.entries()) {
    const name = sanitizeAttachmentFileName(attachment?.name);
    const contentType =
      typeof attachment?.contentType === "string" && attachment.contentType.trim()
        ? attachment.contentType.trim()
        : null;
    const contentLength =
      typeof attachment?.contentLength === "number" && Number.isFinite(attachment.contentLength)
        ? attachment.contentLength
        : null;
    const base64 =
      typeof attachment?.contentBase64 === "string" && attachment.contentBase64.trim()
        ? attachment.contentBase64.trim()
        : "";
    if (!base64) {
      // Provider may omit content; do not fail the whole email.
      continue;
    }

    const bytes = Buffer.from(base64, "base64");
    if (bytes.byteLength <= 0) continue;

    const storagePath = buildEmailAttachmentStoragePath({
      quoteId,
      role,
      filename: name,
    });

    try {
      const { error: uploadError } = await supabaseServer.storage
        .from(EMAIL_ATTACHMENTS_BUCKET)
        .upload(storagePath, bytes, {
          contentType: contentType ?? undefined,
          upsert: false,
        });

      if (uploadError) {
        // Missing bucket / storage config should not block inbound email.
        if (isMissingTableOrColumnError(uploadError)) {
          warnOnce(
            "email_bridge:attachments_storage_missing",
            `${WARN_PREFIX} attachments skipped; storage unavailable`,
          );
          return { ok: true, stored, storageUnavailable: true };
        }

        warnOnce(
          "email_bridge:attachments_storage_failed",
          `${WARN_PREFIX} attachments upload failed; continuing without attachments`,
          { code: serializeSupabaseError(uploadError).code ?? null },
        );
        continue;
      }

      stored.push({
        filename: name,
        storageBucketId: EMAIL_ATTACHMENTS_BUCKET,
        storagePath,
        sizeBytes: bytes.byteLength,
        mime: contentType ?? null,
      });
    } catch (error) {
      warnOnce(
        "email_bridge:attachments_storage_crashed",
        `${WARN_PREFIX} attachments upload crashed; continuing without attachments`,
        { code: serializeSupabaseError(error).code ?? null },
      );
      // Best-effort: skip this attachment.
      continue;
    }
  }

  return { ok: true, stored };
}

async function tryInsertCanonicalFilesForAttachments(args: {
  quoteId: string;
  attachments: StoredInboundAttachment[];
}): Promise<{ ok: boolean; stored: StoredInboundAttachment[] }> {
  const quoteId = normalizeString(args.quoteId);
  const input = Array.isArray(args.attachments) ? args.attachments : [];
  if (!quoteId || input.length === 0) return { ok: true, stored: input };

  // Prefer files_valid, fall back to files.
  const tables = ["files_valid", "files"] as const;

  const tryInsertInto = async (table: (typeof tables)[number]) => {
    try {
      // Most common canonical schema columns. If this fails due to drift, we silently
      // fall back to message-only metadata links.
      const { data, error } = await supabaseServer
        .from(table)
        .insert(
          input.map((a) => ({
            quote_id: quoteId,
            filename: a.filename,
            mime: a.mime ?? "application/octet-stream",
            storage_path: a.storagePath,
            bucket_id: a.storageBucketId,
            size_bytes: a.sizeBytes,
          })),
        )
        .select("id,storage_path")
        .returns<Array<{ id: string; storage_path: string | null }>>();

      if (error) {
        if (isMissingTableOrColumnError(error)) {
          return { ok: true as const, inserted: [] as Array<{ id: string; storage_path: string | null }> };
        }
        warnOnce(
          `email_bridge:attachments_files_insert_failed:${table}`,
          `${WARN_PREFIX} attachment file row insert failed; continuing without file ids`,
          { code: serializeSupabaseError(error).code ?? null },
        );
        return { ok: false as const, inserted: [] as Array<{ id: string; storage_path: string | null }> };
      }

      return { ok: true as const, inserted: Array.isArray(data) ? data : [] };
    } catch (error) {
      if (isMissingTableOrColumnError(error)) {
        return { ok: true as const, inserted: [] as Array<{ id: string; storage_path: string | null }> };
      }
      warnOnce(
        `email_bridge:attachments_files_insert_crashed:${table}`,
        `${WARN_PREFIX} attachment file row insert crashed; continuing without file ids`,
        { code: serializeSupabaseError(error).code ?? null },
      );
      return { ok: false as const, inserted: [] as Array<{ id: string; storage_path: string | null }> };
    }
  };

  for (const table of tables) {
    const result = await tryInsertInto(table);
    if (!result.ok) {
      // Non-missing failure; don't keep retrying.
      return { ok: false, stored: input };
    }
    if (result.inserted.length > 0) {
      const idByPath = new Map<string, string>();
      for (const row of result.inserted) {
        const id = typeof row?.id === "string" ? row.id.trim() : "";
        const path = typeof row?.storage_path === "string" ? row.storage_path.trim() : "";
        if (id && path) idByPath.set(path, id);
      }
      const enriched = input.map((a) => ({
        ...a,
        quoteFileId: idByPath.get(a.storagePath) ?? null,
      }));
      return { ok: true, stored: enriched };
    }
  }

  return { ok: true, stored: input };
}

async function isLikelyDuplicateInboundMessage(args: {
  quoteId: string;
  senderRole: "supplier" | "customer";
  senderId: string;
  body: string;
  subject: string | null;
  inboundDate: string | null;
  providerMessageId: string | null;
}): Promise<{ deduped: boolean; fingerprint: string | null }> {
  const quoteId = normalizeString(args.quoteId);
  const senderRole = args.senderRole;
  const senderId = normalizeString(args.senderId);
  const body = normalizeString(args.body);
  const subject = normalizeString(args.subject) || null;
  const inboundDate = normalizeString(args.inboundDate) || null;
  const providerMessageId = normalizeString(args.providerMessageId) || null;
  if (!quoteId || !senderId || !body) return { deduped: false, fingerprint: null };

  // Best-effort only. Avoid heavy queries and tolerate drift.
  try {
    const MAX_SCAN = 25;

    const computeHourBucket = (dateStr: string | null): string => {
      const d = dateStr ? new Date(dateStr) : new Date();
      const yyyy = String(d.getUTCFullYear());
      const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(d.getUTCDate()).padStart(2, "0");
      const hh = String(d.getUTCHours()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}-${hh}`;
    };

    const normalizeSubjectForFingerprint = (value: string | null): string => {
      const raw = normalizeString(value).toLowerCase();
      if (!raw) return "";
      // Strip repeated reply/forward prefixes.
      let s = raw;
      for (let i = 0; i < 5; i++) {
        const next = s.replace(/^(re|fw|fwd)\s*:\s*/i, "");
        if (next === s) break;
        s = next;
      }
      return s.replace(/\s+/g, " ").trim();
    };

    const normalizeBodyForFingerprint = (value: string): string => {
      return normalizeString(value)
        .toLowerCase()
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    };

    const computeFingerprint = (): string => {
      const bucket = computeHourBucket(inboundDate);
      const normalizedSubject = normalizeSubjectForFingerprint(subject);
      const normalizedBody = normalizeBodyForFingerprint(body);
      const payload = `${senderRole}|${quoteId}|${senderId}|${normalizedSubject}|${normalizedBody}|${bucket}`;
      return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
    };

    const fingerprint = computeFingerprint();

    const readMetaString = (meta: unknown, key: string): string | null => {
      if (!meta || typeof meta !== "object") return null;
      const v = (meta as any)?.[key];
      const s = typeof v === "string" ? v.trim() : "";
      return s ? s : null;
    };

    const readMetaProviderMessageId = (meta: unknown): string | null => {
      // Back-compat: previous phases sometimes used `messageId`.
      return readMetaString(meta, "providerMessageId") ?? readMetaString(meta, "messageId");
    };

    const readMetaFingerprint = (meta: unknown): string | null => readMetaString(meta, "fingerprint");

    // Try to load a small recent window with metadata. If schema drifts, fall back.
    let query = supabaseServer
      .from(QUOTE_MESSAGES_RELATION)
      .select("id,body,created_at,metadata")
      .eq("quote_id", quoteId)
      .eq("sender_role", senderRole)
      .eq("sender_id", senderId)
      .order("created_at", { ascending: false })
      .limit(MAX_SCAN) as any;

    let result = (await query) as { data?: any[]; error?: unknown };
    if (result.error && isMissingTableOrColumnError(result.error)) {
      // Fallback: metadata/created_at might be missing on some schemas; retry with minimal columns.
      const fallbackQuery = supabaseServer
        .from(QUOTE_MESSAGES_RELATION)
        .select("id,body,created_at")
        .eq("quote_id", quoteId)
        .eq("sender_role", senderRole)
        .eq("sender_id", senderId)
        .order("id", { ascending: false })
        .limit(5) as any;
      result = (await fallbackQuery) as { data?: any[]; error?: unknown };
    }

    if (result.error) {
      if (!isMissingTableOrColumnError(result.error)) {
        warnOnce("email_bridge:dedupe_check_failed", `${WARN_PREFIX} dedupe check failed; skipping`, {
          code: serializeSupabaseError(result.error).code ?? null,
        });
      }
      return { deduped: false, fingerprint: null };
    }

    const rows = Array.isArray(result.data) ? result.data : [];
    const nowMs = Date.now();
    const windowMs = 5 * 60 * 1000;

    for (const row of rows) {
      const rowMeta = row?.metadata && typeof row.metadata === "object" ? (row.metadata as any) : null;

      // Priority A: provider message id match (deterministic).
      if (providerMessageId) {
        const prevId = readMetaProviderMessageId(rowMeta);
        if (prevId && normalizeString(prevId) === providerMessageId) {
          return { deduped: true, fingerprint };
        }
      }

      // Priority B: fingerprint match (deterministic fallback).
      const prevFingerprint = readMetaFingerprint(rowMeta);
      if (prevFingerprint && prevFingerprint === fingerprint) {
        return { deduped: true, fingerprint };
      }

      // Fail-soft fallback: body match within the short window.
      const rowBody = typeof row?.body === "string" ? row.body.trim() : "";
      if (!rowBody || rowBody !== body) continue;

      const createdAt = typeof row?.created_at === "string" ? row.created_at : null;
      if (createdAt) {
        const ms = Date.parse(createdAt);
        if (Number.isFinite(ms) && nowMs - ms > windowMs) {
          continue;
        }
      }

      return { deduped: true, fingerprint };
    }

    return { deduped: false, fingerprint };
  } catch (error) {
    if (!isMissingTableOrColumnError(error)) {
      warnOnce("email_bridge:dedupe_check_crashed", `${WARN_PREFIX} dedupe check crashed; skipping`, {
        code: serializeSupabaseError(error).code ?? null,
      });
    }
    return { deduped: false, fingerprint: null };
  }
}

type InboundHandleResult =
  | { ok: true; deduped?: true }
  | { ok: false; error: string; httpStatus: 200 | 400 | 401 };

export function getCustomerReplyToAddress(args: {
  quoteId: string;
  customerId: string;
}): { ok: true; address: string } | { ok: false; reason: "disabled" | "missing_domain" } {
  const secret = normalizeString(process.env.EMAIL_BRIDGE_SECRET);
  if (!secret) {
    return { ok: false, reason: "disabled" };
  }

  const replyDomain = normalizeString(process.env.EMAIL_REPLY_DOMAIN);
  if (!replyDomain) {
    return { ok: false, reason: "missing_domain" };
  }

  const token = createCustomerReplyToken({
    quoteId: args.quoteId,
    customerId: args.customerId,
    secret,
  });
  if (!token) {
    return { ok: false, reason: "disabled" };
  }

  return { ok: true, address: `reply+${token}@${replyDomain}` };
}

export async function handleInboundSupplierEmail(inbound: InboundEmail): Promise<InboundHandleResult> {
  const secret = normalizeString(process.env.EMAIL_BRIDGE_SECRET);
  if (!secret) {
    return { ok: false, error: "disabled", httpStatus: 200 };
  }

  // Loop prevention: refuse to ingest messages that appear to originate from our own system.
  // Comparison is performed in-memory only; do not log addresses.
  if (isInternalInboundSender(inbound?.from)) {
    return { ok: false, error: "ignored_internal_sender", httpStatus: 200 };
  }

  const to = Array.isArray(inbound?.to) ? inbound.to : [];
  const tokenResult = parseReplyToTokenFromRecipients(to);
  if (!tokenResult.ok) {
    console.warn(`${WARN_PREFIX} token invalid`, { reason: tokenResult.reason });
    return { ok: false, error: "token_missing_or_malformed", httpStatus: 400 };
  }

  const { quoteId, partyId: supplierId, sig } = tokenResult.parts;
  const valid = verifyReplyToken({ quoteId, supplierId, sig, secret });
  if (!valid) {
    console.warn(`${WARN_PREFIX} token invalid`, { reason: "bad_sig" });
    return { ok: false, error: "token_invalid", httpStatus: 401 };
  }

  const body = sanitizeBody(inbound);
  if (!body) {
    return { ok: false, error: "empty_body", httpStatus: 400 };
  }

  const supported = await schemaGate({
    enabled: true,
    relation: QUOTE_MESSAGES_RELATION,
    requiredColumns: ["quote_id", "sender_role", "sender_id", "body"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_bridge:quote_messages",
  });
  if (!supported) {
    warnOnce("email_bridge:unsupported", `${WARN_PREFIX} unsupported; quote_messages missing`);
    return { ok: false, error: "unsupported", httpStatus: 200 };
  }

  const providerMessageId =
    normalizeString(inbound.providerMessageId) || normalizeString(inbound.messageId) || null;
  const dedupeResult = await isLikelyDuplicateInboundMessage({
    quoteId,
    senderRole: "supplier",
    senderId: supplierId,
    body,
    subject: normalizeString(inbound.subject) || null,
    inboundDate: normalizeString(inbound.date) || null,
    providerMessageId,
  });
  if (dedupeResult.deduped) {
    return { ok: true, deduped: true };
  }

  const inboundAttachments = Array.isArray(inbound.attachments) ? inbound.attachments : [];
  const uploadedAttachmentsResult =
    inboundAttachments.length > 0
      ? await uploadInboundEmailAttachments({
          quoteId,
          role: "supplier",
          attachments: inboundAttachments,
        })
      : { ok: true as const, stored: [] as StoredInboundAttachment[] };

  const canonicalFilesResult =
    uploadedAttachmentsResult.ok && uploadedAttachmentsResult.stored.length > 0
      ? await tryInsertCanonicalFilesForAttachments({
          quoteId,
          attachments: uploadedAttachmentsResult.stored,
        })
      : { ok: true as const, stored: uploadedAttachmentsResult.stored ?? [] };

  const storedAttachments = canonicalFilesResult.stored;

  // Try the extended payload first (newer schemas). If it fails due to missing columns,
  // retry with the minimal schema-compatible payload to avoid noisy drift errors.
  const basePayload: Record<string, unknown> = {
    quote_id: quoteId,
    sender_role: "supplier",
    sender_id: supplierId,
    sender_name: "Supplier",
    // IMPORTANT: Do not store or log inbound From (PII). Attribute solely via reply token.
    sender_email: null,
    body,
  };

  const attachSuffixLine =
    inboundAttachments.length > 0 &&
    (uploadedAttachmentsResult as any)?.storageUnavailable &&
    storedAttachments.length === 0
      ? "\n\n(Attachments received; storage unavailable)"
      : "";

  const extendedPayload: Record<string, unknown> = {
    ...basePayload,
    supplier_id: supplierId,
    metadata: {
      via: "email",
      outbound: false,
      provider: normalizeString(inbound.provider) === "postmark" ? "postmark" : "generic",
      providerMessageId,
      inReplyTo: normalizeString(inbound.inReplyTo) || null,
      referencesCount: Array.isArray(inbound.references) ? inbound.references.length : 0,
      fingerprint: dedupeResult.fingerprint,
      attachments:
        storedAttachments.length > 0
          ? storedAttachments.map((a) => ({
              filename: a.filename,
              storageBucketId: a.storageBucketId,
              storagePath: a.storagePath,
              sizeBytes: a.sizeBytes,
              mime: a.mime,
              quoteFileId: a.quoteFileId ?? null,
            }))
          : null,
    },
    body: `${body}${attachSuffixLine}`,
  };

  try {
    const { error: extendedError } = await supabaseServer.from(QUOTE_MESSAGES_RELATION).insert(extendedPayload);
    if (!extendedError) {
      return { ok: true };
    }

    const serialized = serializeSupabaseError(extendedError);
    warnOnce("email_bridge:insert_extended_failed", `${WARN_PREFIX} insert degraded; retrying minimal`, {
      code: serialized.code,
      message: serialized.message,
    });

    const { error: baseError } = await supabaseServer.from(QUOTE_MESSAGES_RELATION).insert({
      ...basePayload,
      body: `${body}${attachSuffixLine}`,
    });
    if (baseError) {
      console.error(`${WARN_PREFIX} insert failed`, { error: serializeSupabaseError(baseError) ?? baseError });
      return { ok: false, error: "write_failed", httpStatus: 200 };
    }

    return { ok: true };
  } catch (error) {
    console.error(`${WARN_PREFIX} insert crashed`, { error });
    return { ok: false, error: "write_failed", httpStatus: 200 };
  }
}

export async function handleInboundCustomerEmail(inbound: InboundEmail): Promise<InboundHandleResult> {
  const secret = normalizeString(process.env.EMAIL_BRIDGE_SECRET);
  if (!secret) {
    return { ok: false, error: "disabled", httpStatus: 200 };
  }

  // Loop prevention: refuse to ingest messages that appear to originate from our own system.
  // Comparison is performed in-memory only; do not log addresses.
  if (isInternalInboundSender(inbound?.from)) {
    return { ok: false, error: "ignored_internal_sender", httpStatus: 200 };
  }

  const to = Array.isArray(inbound?.to) ? inbound.to : [];
  const tokenResult = parseReplyToTokenFromRecipients(to);
  if (!tokenResult.ok) {
    return { ok: false, error: "token_missing_or_malformed", httpStatus: 400 };
  }

  const { quoteId, partyId: customerId, sig } = tokenResult.parts;
  const valid = verifyCustomerReplyToken({ quoteId, customerId, sig, secret });
  if (!valid) {
    return { ok: false, error: "token_invalid", httpStatus: 401 };
  }

  // Safe-by-default: even when outbound exists, inbound customer replies are ignored unless opted in.
  const optedIn = await isCustomerEmailOptedIn({ quoteId, customerId });
  if (!optedIn) {
    return { ok: false, error: "not_opted_in", httpStatus: 200 };
  }

  const body = sanitizeBody(inbound);
  if (!body) {
    return { ok: false, error: "empty_body", httpStatus: 400 };
  }

  const supported = await schemaGate({
    enabled: true,
    relation: QUOTE_MESSAGES_RELATION,
    requiredColumns: ["quote_id", "sender_role", "sender_id", "body"],
    warnPrefix: WARN_PREFIX,
    warnKey: "email_bridge:quote_messages_customer",
  });
  if (!supported) {
    warnOnce("email_bridge:unsupported_customer", `${WARN_PREFIX} unsupported; quote_messages missing`);
    return { ok: false, error: "unsupported", httpStatus: 200 };
  }

  const providerMessageId =
    normalizeString(inbound.providerMessageId) || normalizeString(inbound.messageId) || null;
  const dedupeResult = await isLikelyDuplicateInboundMessage({
    quoteId,
    senderRole: "customer",
    senderId: customerId,
    body,
    subject: normalizeString(inbound.subject) || null,
    inboundDate: normalizeString(inbound.date) || null,
    providerMessageId,
  });
  if (dedupeResult.deduped) {
    return { ok: true, deduped: true };
  }

  const inboundAttachments = Array.isArray(inbound.attachments) ? inbound.attachments : [];
  const uploadedAttachmentsResult =
    inboundAttachments.length > 0
      ? await uploadInboundEmailAttachments({
          quoteId,
          role: "customer",
          attachments: inboundAttachments,
        })
      : { ok: true as const, stored: [] as StoredInboundAttachment[] };

  const canonicalFilesResult =
    uploadedAttachmentsResult.ok && uploadedAttachmentsResult.stored.length > 0
      ? await tryInsertCanonicalFilesForAttachments({
          quoteId,
          attachments: uploadedAttachmentsResult.stored,
        })
      : { ok: true as const, stored: uploadedAttachmentsResult.stored ?? [] };

  const storedAttachments = canonicalFilesResult.stored;

  // IMPORTANT: Do not store or log inbound From (PII). Attribute solely via reply token.
  const basePayload: Record<string, unknown> = {
    quote_id: quoteId,
    sender_role: "customer",
    sender_id: customerId,
    sender_name: "Customer",
    sender_email: null,
    body,
  };

  const attachSuffixLine =
    inboundAttachments.length > 0 &&
    (uploadedAttachmentsResult as any)?.storageUnavailable &&
    storedAttachments.length === 0
      ? "\n\n(Attachments received; storage unavailable)"
      : "";

  const extendedPayload: Record<string, unknown> = {
    ...basePayload,
    customer_id: customerId,
    metadata: {
      via: "email",
      outbound: false,
      provider: normalizeString(inbound.provider) === "postmark" ? "postmark" : "generic",
      providerMessageId,
      inReplyTo: normalizeString(inbound.inReplyTo) || null,
      referencesCount: Array.isArray(inbound.references) ? inbound.references.length : 0,
      fingerprint: dedupeResult.fingerprint,
      attachments:
        storedAttachments.length > 0
          ? storedAttachments.map((a) => ({
              filename: a.filename,
              storageBucketId: a.storageBucketId,
              storagePath: a.storagePath,
              sizeBytes: a.sizeBytes,
              mime: a.mime,
              quoteFileId: a.quoteFileId ?? null,
            }))
          : null,
    },
    body: `${body}${attachSuffixLine}`,
  };

  try {
    const { error: extendedError } = await supabaseServer.from(QUOTE_MESSAGES_RELATION).insert(extendedPayload);
    if (!extendedError) {
      return { ok: true };
    }

    const serialized = serializeSupabaseError(extendedError);
    warnOnce("email_bridge:customer_insert_extended_failed", `${WARN_PREFIX} insert degraded; retrying minimal`, {
      code: serialized.code,
      message: serialized.message,
    });

    const { error: baseError } = await supabaseServer.from(QUOTE_MESSAGES_RELATION).insert({
      ...basePayload,
      body: `${body}${attachSuffixLine}`,
    });
    if (baseError) {
      console.error(`${WARN_PREFIX} insert failed`, { error: serializeSupabaseError(baseError) ?? baseError });
      return { ok: false, error: "write_failed", httpStatus: 200 };
    }

    return { ok: true };
  } catch (error) {
    console.error(`${WARN_PREFIX} insert crashed`, { error });
    return { ok: false, error: "write_failed", httpStatus: 200 };
  }
}

/**
 * Shared inbound router (supplier + customer).
 * - Extracts the reply token from recipients
 * - Validates supplier token first (back-compat), then customer token
 * - Returns 401 for bad signatures to stop provider retries
 */
export async function handleInboundEmailBridge(inbound: InboundEmail): Promise<InboundHandleResult> {
  const secret = normalizeString(process.env.EMAIL_BRIDGE_SECRET);
  if (!secret) {
    return { ok: false, error: "disabled", httpStatus: 200 };
  }

  const to = Array.isArray(inbound?.to) ? inbound.to : [];
  const tokenResult = parseReplyToTokenFromRecipients(to);
  if (!tokenResult.ok) {
    return { ok: false, error: "token_missing_or_malformed", httpStatus: 400 };
  }

  const { quoteId, partyId, sig } = tokenResult.parts;

  // Try supplier first (existing tokens).
  if (verifyReplyToken({ quoteId, supplierId: partyId, sig, secret })) {
    return handleInboundSupplierEmail(inbound);
  }

  // Then customer scope.
  if (verifyCustomerReplyToken({ quoteId, customerId: partyId, sig, secret })) {
    return handleInboundCustomerEmail(inbound);
  }

  return { ok: false, error: "token_invalid", httpStatus: 401 };
}

