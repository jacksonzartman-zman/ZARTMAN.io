"use client";

/**
 * Phase 1 Polish checklist
 * - Done: Empty state card (role-agnostic, calm guidance)
 * - Done: Success/error surfaces keep copy actionable
 * - Done: Sending state keeps perceived speed (no scary spinners)
 */

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useFormState, useFormStatus } from "react-dom";
import clsx from "clsx";
import type { SupabaseClient } from "@supabase/supabase-js";

import { formatDateTime } from "@/lib/formatDate";
import { supabaseBrowser } from "@/lib/supabase.client";
import type { QuoteMessageRecord } from "@/server/quotes/messages";
import type { QuoteMessageFormState } from "@/app/(portals)/components/QuoteMessagesThread.types";
import type { OutboundFileOption } from "@/server/quotes/outboundFilePicker";
import { EmptyStateCard } from "@/components/EmptyStateCard";
import { CopyTextButton } from "@/components/CopyTextButton";
import { ctaSizeClasses, primaryCtaClasses } from "@/lib/ctas";

const CHANGE_REQUEST_SUBMITTED_EVENT = "zartman:change-request-submitted";
const CHANGE_REQUEST_CREATED_PREFIX = "Change request created:";

export type QuoteMessagesThreadProps = {
  quoteId: string;
  messages: QuoteMessageRecord[];
  canPost: boolean;
  /**
   * When true, render without the outer "card" chrome + large header.
   * Intended for embedding inside another surface (e.g. `DisclosureSection`).
   */
  embedded?: boolean;
  postAction?: (
    prevState: QuoteMessageFormState,
    formData: FormData,
  ) => Promise<QuoteMessageFormState>;
  currentUserId: string | null;
  /**
   * When true, mark this quote's messages as read for the current user.
   * Intended for use when the `tab=messages` view is opened.
   */
  markRead?: boolean;
  /**
   * Used to enforce masked identities:
   * - NEVER display real email addresses (admin included)
   */
  viewerRole?: "admin" | "customer" | "supplier" | (string & {}) | null;
  className?: string;
  title?: string;
  description?: string;
  /**
   * Short guidance line shown under the section header.
   * Example: "Use Messages for clarifications, change requests, and questions."
   */
  usageHint?: string;
  helperText?: string;
  disabledCopy?: string | null;
  emptyStateCopy?: string;
  emailReplyIndicator?:
    | { state: "enabled"; replyTo: string }
    | {
        state: "off";
        helper?: string | null;
        cta?: { label: string; href: string } | null;
      };
  /**
   * Optional "send this message as email" enhancer (customer/supplier portals only).
   * When enabled, the submit action may route to outbound email instead of creating
   * an in-portal message (handled server-side by the provided `postAction`).
   */
  portalEmail?: {
    enabled: boolean;
    /**
     * Who the email will be sent to (do NOT display any real addresses).
     */
    recipientRole: "supplier" | "customer";
    /**
     * Optional file options to attach (max 5 enforced server-side).
     */
    fileOptions?: OutboundFileOption[];
    /**
     * Optional reason shown when email sending is disabled.
     */
    disabledCopy?: string | null;
  } | null;
};

const DEFAULT_FORM_STATE: QuoteMessageFormState = {
  ok: true,
  message: null,
  error: null,
  fieldErrors: {},
};

export function QuoteMessagesThread({
  quoteId,
  messages,
  canPost,
  embedded = false,
  postAction,
  currentUserId,
  markRead = false,
  viewerRole = null,
  className,
  title = "Messages",
  description = "Shared thread with your supplier and the Zartman team.",
  usageHint = "Use Messages for quick questions and change requests.",
  helperText,
  disabledCopy,
  emptyStateCopy = "No messages yet. Send a note when you need clarification or want to confirm details.",
  emailReplyIndicator,
  portalEmail = null,
}: QuoteMessagesThreadProps) {
  const [hasMounted, setHasMounted] = useState(false);
  const realtimeMessages = useQuoteMessagesRealtime(quoteId, messages);
  const [optimisticMessage, setOptimisticMessage] = useState<QuoteMessageRecord | null>(null);
  const sortedMessages = useMemo(
    () => sortMessages(realtimeMessages),
    [realtimeMessages],
  );
  const messagesWithOptimistic = useMemo(() => {
    if (!optimisticMessage) return sortedMessages;
    // Always dedupe by id; keep optimistic as a single stable row across retries.
    if (sortedMessages.some((m) => m.id === optimisticMessage.id)) return sortedMessages;
    return sortMessages([...sortedMessages, optimisticMessage]);
  }, [sortedMessages, optimisticMessage]);
  const composerEnabled = Boolean(postAction) && canPost;
  const [showChangeRequestBanner, setShowChangeRequestBanner] = useState(false);
  const bannerTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    const onSubmitted = () => {
      setShowChangeRequestBanner(true);
      if (bannerTimeoutRef.current) {
        window.clearTimeout(bannerTimeoutRef.current);
      }
      bannerTimeoutRef.current = window.setTimeout(() => {
        setShowChangeRequestBanner(false);
        bannerTimeoutRef.current = null;
      }, 6000);
    };

    window.addEventListener(CHANGE_REQUEST_SUBMITTED_EVENT, onSubmitted);
    return () => {
      window.removeEventListener(CHANGE_REQUEST_SUBMITTED_EVENT, onSubmitted);
      if (bannerTimeoutRef.current) {
        window.clearTimeout(bannerTimeoutRef.current);
        bannerTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!markRead) return;
    if (!quoteId) return;
    if (!currentUserId) return;

    // Best-effort: update read state without blocking UI.
    void fetch("/api/quote-message-reads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quoteId }),
    }).catch(() => null);
  }, [markRead, quoteId, currentUserId]);

  useEffect(() => {
    if (!optimisticMessage) return;
    if (!currentUserId) return;
    // Best-effort: if the real message arrives via realtime, clear the optimistic row.
    // Matching is intentionally conservative to avoid clearing older identical messages.
    const optimisticCreatedAt = Date.parse(optimisticMessage.created_at);
    if (!Number.isFinite(optimisticCreatedAt)) return;
    const matched = sortedMessages.some((m) => {
      if (m.sender_id !== currentUserId) return false;
      if ((m.body ?? "").trim() !== (optimisticMessage.body ?? "").trim()) return false;
      const created = Date.parse(m.created_at);
      if (!Number.isFinite(created)) return false;
      // Only consider a small window around the optimistic send time.
      return created >= optimisticCreatedAt - 5000 && created <= optimisticCreatedAt + 60_000;
    });
    if (matched) {
      setOptimisticMessage(null);
    }
  }, [sortedMessages, optimisticMessage, currentUserId]);

  return (
    <section
      className={clsx(
        embedded
          ? "space-y-5"
          : "space-y-5 rounded-2xl border border-slate-900 bg-slate-950/50 px-6 py-5",
        className,
      )}
    >
      {!embedded ? (
        <header className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Messages
          </p>
          <div>
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            <p className="text-sm text-slate-400">{description}</p>
          </div>
          {showChangeRequestBanner ? (
            <p
              className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100"
              role="status"
              aria-live="polite"
            >
              Change request submitted. We&apos;ll coordinate updates in Messages.
            </p>
          ) : null}
          {usageHint ? <p className="text-xs text-slate-500">{usageHint}</p> : null}
          {emailReplyIndicator ? <EmailReplyIndicatorRow indicator={emailReplyIndicator} /> : null}
        </header>
      ) : (
        <>
          {showChangeRequestBanner ? (
            <p
              className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100"
              role="status"
              aria-live="polite"
            >
              Change request submitted. We&apos;ll coordinate updates in Messages.
            </p>
          ) : null}
          {emailReplyIndicator ? (
            <EmailReplyIndicatorRow indicator={emailReplyIndicator} embedded />
          ) : null}
        </>
      )}

      <QuoteMessageList
        quoteId={quoteId}
        messages={messagesWithOptimistic}
        currentUserId={currentUserId}
        viewerRole={viewerRole}
        emptyStateCopy={emptyStateCopy}
        showTimestamps={hasMounted}
      />

      {composerEnabled && postAction ? (
        <QuoteMessageComposer
          quoteId={quoteId}
          postAction={postAction}
          helperText={helperText}
          disabledCopy={canPost ? null : disabledCopy}
          viewerRole={viewerRole}
          portalEmail={portalEmail}
          currentUserId={currentUserId}
          onOptimisticMessageChange={setOptimisticMessage}
        />
      ) : !canPost && disabledCopy ? (
        <p className="rounded-xl border border-dashed border-slate-800/70 bg-black/30 px-5 py-3 text-xs text-slate-400">
          {disabledCopy}
        </p>
      ) : null}
    </section>
  );
}

function EmailReplyIndicatorRow({
  indicator,
  embedded = false,
}: {
  indicator: NonNullable<QuoteMessagesThreadProps["emailReplyIndicator"]>;
  embedded?: boolean;
}) {
  return (
    <div
      className={clsx(
        "flex flex-wrap items-center gap-2 text-xs",
        embedded ? "rounded-xl border border-slate-900/60 bg-slate-950/30 px-4 py-2" : null,
      )}
    >
      {indicator.state === "enabled" ? (
        <>
          <span className="text-emerald-200">Email replies enabled</span>
          <span
            className="break-anywhere rounded-md border border-slate-900/60 bg-slate-950/30 px-2 py-1 font-mono text-[11px] text-slate-100"
            title={indicator.replyTo}
          >
            {indicator.replyTo}
          </span>
          <CopyTextButton
            text={indicator.replyTo}
            idleLabel="Copy reply-to"
            logPrefix="[email_bridge]"
          />
        </>
      ) : (
        <>
          <span className="text-slate-500">Email replies off</span>
          {indicator.helper ? <span className="text-slate-500">{indicator.helper}</span> : null}
          {indicator.cta?.href && indicator.cta?.label ? (
            <a
              href={indicator.cta.href}
              className="font-semibold text-emerald-200 underline-offset-4 hover:underline"
            >
              {indicator.cta.label}
            </a>
          ) : null}
        </>
      )}
    </div>
  );
}

function QuoteMessageList({
  quoteId,
  messages,
  currentUserId,
  viewerRole,
  emptyStateCopy,
  showTimestamps,
}: {
  quoteId: string;
  messages: QuoteMessageRecord[];
  currentUserId: string | null;
  viewerRole: QuoteMessagesThreadProps["viewerRole"];
  emptyStateCopy: string;
  showTimestamps: boolean;
}) {
  if (messages.length === 0) {
    return (
      <EmptyStateCard
        title="No messages yet"
        description={emptyStateCopy}
        className="px-6 py-5"
        footer={
          <button
            type="button"
            className={[
              primaryCtaClasses,
              ctaSizeClasses.sm,
              "w-full sm:w-auto",
            ].join(" ")}
            aria-label="Write a message"
            onClick={() => {
              focusQuoteMessageComposerTextarea(quoteId);
            }}
          >
            Write a message
          </button>
        }
      />
    );
  }

  return (
    <div className="min-w-0 max-h-[28rem] space-y-3 overflow-y-auto pr-1">
      {messages.map((message) => {
        const optimisticMeta = readOptimisticMeta(message);
        const isCurrentUser =
          typeof currentUserId === "string" &&
          message.sender_id === currentUserId;
        const normalizedRole = (message.sender_role ?? "").toLowerCase();
        const isChangeRequestSystemMessage =
          normalizedRole === "system" &&
          (message.body ?? "").trimStart().startsWith(CHANGE_REQUEST_CREATED_PREFIX);
        const roleLabel = resolveRoleLabel(message.sender_role);
        const displayLabel = resolveDisplayLabel({
          isCurrentUser,
          roleLabel,
          senderName: message.sender_name,
        });
        const emailProvenance = isEmailProvenance(message);
        const attachments = readMessageAttachments(message);

        return (
          <article
            key={message.id}
            className={clsx(
              "rounded-2xl border px-5 py-4",
              isCurrentUser
                ? "border-emerald-500/40 bg-emerald-500/10"
                : "border-slate-900/70 bg-slate-950/40",
              isChangeRequestSystemMessage
                ? "border-l-4 border-l-emerald-400/50"
                : null,
              optimisticMeta ? "border-dashed" : null,
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={clsx(
                    "max-w-[70vw] truncate rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide sm:max-w-[18rem]",
                    resolveRoleClasses(isCurrentUser, message.sender_role),
                  )}
                  title={displayLabel}
                >
                  {displayLabel}
                </span>
                {!isCurrentUser ? (
                  <span className="text-slate-500">{roleLabel}</span>
                ) : null}
                {isChangeRequestSystemMessage ? (
                  <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">
                    Change request
                  </span>
                ) : null}
                {emailProvenance ? (
                  <span
                    className="rounded-full border border-slate-700/70 bg-slate-900/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-200"
                    title="Received via email"
                  >
                    Email
                  </span>
                ) : null}
              </div>
              <span>
                {showTimestamps
                  ? formatDateTime(message.created_at, { includeTime: true }) ?? "Just now"
                  : "—"}
              </span>
            </div>
            <p className="break-anywhere mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
              {message.body}
            </p>
            {optimisticMeta?.status ? (
              <p
                className={clsx(
                  "mt-2 text-xs",
                  optimisticMeta.status === "failed" ? "text-amber-200/90" : "text-slate-400",
                )}
                role={optimisticMeta.status === "failed" ? "status" : undefined}
                aria-live={optimisticMeta.status === "failed" ? "polite" : undefined}
              >
                {optimisticMeta.status === "failed" ? "Not sent" : "Sending…"}
              </p>
            ) : null}
            {attachments.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {attachments.map((a, idx) => {
                  const label = a.filename || "Attachment";
                  const href = a.downloadUrl || null;
                  return href ? (
                    <a
                      key={`${message.id}-att-${idx}`}
                      href={href}
                      className="inline-flex items-center rounded-full border border-slate-800 bg-black/30 px-3 py-1 text-[11px] font-semibold text-slate-200 transition hover:border-slate-600 hover:text-white"
                    >
                      {label}
                    </a>
                  ) : (
                    <span
                      key={`${message.id}-att-${idx}`}
                      className="inline-flex items-center rounded-full border border-slate-900 bg-black/20 px-3 py-1 text-[11px] font-semibold text-slate-500"
                      title="Attachment available, but download is unavailable."
                    >
                      {label}
                    </span>
                  );
                })}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function resolveDisplayLabel(args: {
  isCurrentUser: boolean;
  roleLabel: string;
  senderName: string | null;
}): string {
  if (args.isCurrentUser) return "You";

  const name = typeof args.senderName === "string" ? args.senderName.trim() : "";
  if (name && !looksLikeEmail(name)) {
    return name;
  }

  return args.roleLabel;
}

function looksLikeEmail(value: string): boolean {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) return false;
  // Conservative: any @-containing label is treated as an email-ish identifier.
  return v.includes("@");
}

function isEmailProvenance(message: QuoteMessageRecord): boolean {
  const meta = (message as any)?.metadata;
  if (!meta || typeof meta !== "object") return false;
  const via = (meta as any)?.via;
  const normalized = typeof via === "string" ? via.trim().toLowerCase() : "";
  return normalized.includes("email");
}

function readMessageAttachments(message: QuoteMessageRecord): Array<{ filename: string; downloadUrl?: string | null }> {
  const meta = (message as any)?.metadata;
  if (!meta || typeof meta !== "object") return [];
  const raw = (meta as any)?.attachments;
  if (!Array.isArray(raw)) return [];
  const out: Array<{ filename: string; downloadUrl?: string | null }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const filename = typeof (item as any).filename === "string" ? (item as any).filename.trim() : "";
    const downloadUrl =
      typeof (item as any).downloadUrl === "string" && (item as any).downloadUrl.trim()
        ? ((item as any).downloadUrl as string)
        : null;
    if (!filename) continue;
    out.push({ filename, downloadUrl });
  }
  return out;
}

function QuoteMessageComposer({
  quoteId,
  postAction,
  helperText,
  disabledCopy,
  viewerRole,
  portalEmail,
  currentUserId,
  onOptimisticMessageChange,
}: {
  quoteId: string;
  postAction: (
    prevState: QuoteMessageFormState,
    formData: FormData,
  ) => Promise<QuoteMessageFormState>;
  helperText?: string;
  disabledCopy?: string | null;
  viewerRole: QuoteMessagesThreadProps["viewerRole"];
  portalEmail: QuoteMessagesThreadProps["portalEmail"];
  currentUserId: string | null;
  onOptimisticMessageChange?: Dispatch<SetStateAction<QuoteMessageRecord | null>>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [state, formAction] = useFormState(postAction, DEFAULT_FORM_STATE);
  const [sendViaEmail, setSendViaEmail] = useState(false);
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);

  useEffect(() => {
    if (!state.ok || !state.message) {
      return;
    }
    formRef.current?.reset();
    if (textareaRef.current) {
      textareaRef.current.value = "";
    }
    setSendViaEmail(false);
    setSelectedAttachmentIds([]);
    onOptimisticMessageChange?.(null);
  }, [state.ok, state.message]);

  const bodyError = state.fieldErrors?.body;
  const showSendFailure = Boolean(!state.ok && state.error && !bodyError);
  const portalEmailVisible =
    Boolean(portalEmail) &&
    (viewerRole === "customer" || viewerRole === "supplier");
  const portalEmailEnabled = Boolean(portalEmailVisible && portalEmail?.enabled);
  const portalEmailDisabledCopy =
    portalEmailVisible && !portalEmailEnabled
      ? portalEmail?.disabledCopy ?? "Email not configured."
      : null;
  const fileOptions = portalEmailVisible && Array.isArray(portalEmail?.fileOptions)
    ? (portalEmail!.fileOptions as OutboundFileOption[])
    : [];
  const maxLen = sendViaEmail ? 5000 : 2000;
  const selectedCount = selectedAttachmentIds.length;

  useEffect(() => {
    if (sendViaEmail) return;
    if (!onOptimisticMessageChange) return;
    if (!showSendFailure) return;
    onOptimisticMessageChange((current) => {
      const optimistic = readOptimisticMeta(current);
      if (!optimistic) return current;
      return {
        ...current!,
        metadata: { ...(current as any)?.metadata, status: "failed" },
      };
    });
  }, [showSendFailure, sendViaEmail, onOptimisticMessageChange]);

  return (
    <div className="space-y-3 border-t border-slate-900/60 pt-4">
      <div>
        <p className="text-sm font-semibold text-slate-100">Send a message</p>
        {helperText ? (
          <p className="text-xs text-slate-500">{helperText}</p>
        ) : null}
        {disabledCopy ? (
          <p className="text-xs text-slate-500">{disabledCopy}</p>
        ) : null}
      </div>
      <QuoteMessageSuggestionsRow quoteId={quoteId} />
      {showSendFailure ? (
        <ComposerSendFailureRow />
      ) : null}
      {state.ok && state.message ? (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-100">
          {state.message}
        </p>
      ) : null}
      <form
        ref={formRef}
        action={formAction}
        className="space-y-3"
        onSubmit={() => {
          // Add/update an optimistic row for the message thread.
          // This is UI-only: it never touches schema and avoids duplicates on retry
          // by reusing the same optimistic id for the same draft body.
          if (sendViaEmail) return;
          const userId = typeof currentUserId === "string" ? currentUserId : "";
          if (!userId) return;
          const raw = textareaRef.current?.value ?? "";
          const trimmed = raw.trim();
          if (!trimmed) return;
          onOptimisticMessageChange?.((current) => {
            const existing = readOptimisticMeta(current) ? (current as QuoteMessageRecord) : null;
            const reuseId = Boolean(existing && (existing.body ?? "").trim() === trimmed);
            const id = reuseId ? existing!.id : makeOptimisticMessageId(quoteId);
            const now = new Date().toISOString();
            const roleRaw = typeof viewerRole === "string" ? viewerRole.trim().toLowerCase() : "";
            const senderRole =
              roleRaw === "supplier"
                ? "supplier"
                : roleRaw === "customer"
                  ? "customer"
                  : ("admin" as const);
            return {
              id,
              quote_id: quoteId,
              sender_id: userId,
              sender_role: senderRole,
              sender_name: null,
              sender_email: null,
              body: trimmed,
              created_at: now,
              updated_at: null,
              metadata: { _optimistic: true, status: "sending" },
            };
          });
        }}
      >
        {portalEmailVisible ? (
          <div className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">Send via email</p>
                <p className="mt-1 text-xs text-slate-400">
                  Sends a masked email through this thread. Replies stay private and return here.
                </p>
              </div>
              <label
                className={clsx(
                  "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide",
                  portalEmailEnabled
                    ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100 hover:border-emerald-300"
                    : "border-slate-800/80 bg-black/20 text-slate-500 cursor-not-allowed",
                )}
                title={
                  portalEmailEnabled
                    ? "Send this message as email"
                    : portalEmailDisabledCopy ?? "Email not configured."
                }
              >
                <input
                  type="checkbox"
                  name="sendViaEmail"
                  value="1"
                  checked={sendViaEmail}
                  disabled={!portalEmailEnabled}
                  onChange={(e) => {
                    const next = Boolean(e.target.checked);
                    setSendViaEmail(next);
                    if (!next) {
                      setSelectedAttachmentIds([]);
                    }
                    // Email sends may not create an in-portal message; avoid showing optimistic thread rows.
                    if (next) {
                      onOptimisticMessageChange?.(null);
                    }
                  }}
                />
                Send this message as email
              </label>
            </div>
            {!portalEmailEnabled && portalEmailDisabledCopy ? (
              <p className="mt-2 text-xs text-slate-500">{portalEmailDisabledCopy}</p>
            ) : sendViaEmail ? (
              <div className="mt-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Attach files (optional)
                  </p>
                  <p className="text-xs text-slate-500">
                    {selectedCount}/5 selected
                  </p>
                </div>
                {fileOptions.length === 0 ? (
                  <p className="text-xs text-slate-500">No files available to attach.</p>
                ) : (
                  <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-900/60 bg-black/20 p-3">
                    <div className="space-y-2">
                      {fileOptions.slice(0, 50).map((opt) => {
                        const id = typeof opt?.id === "string" ? opt.id : "";
                        if (!id) return null;
                        const filename =
                          typeof opt?.filename === "string" && opt.filename.trim()
                            ? opt.filename.trim()
                            : "File";
                        const checked = selectedAttachmentIds.includes(id);
                        const disablePick = !checked && selectedAttachmentIds.length >= 5;
                        return (
                          <label
                            key={id}
                            className={clsx(
                              "flex items-start gap-3 rounded-lg border px-3 py-2",
                              checked
                                ? "border-emerald-500/30 bg-emerald-500/10"
                                : "border-slate-900/60 bg-slate-950/20",
                              disablePick ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
                            )}
                          >
                            <input
                              type="checkbox"
                              name="attachmentFileIds"
                              value={id}
                              checked={checked}
                              disabled={disablePick}
                              onChange={(e) => {
                                const nextChecked = Boolean(e.target.checked);
                                setSelectedAttachmentIds((current) => {
                                  const set = new Set(current);
                                  if (nextChecked) {
                                    if (set.size >= 5) return current;
                                    set.add(id);
                                  } else {
                                    set.delete(id);
                                  }
                                  return Array.from(set).slice(0, 5);
                                });
                              }}
                            />
                            <span className="min-w-0">
                              <span
                                className="block truncate text-xs font-semibold text-slate-100"
                                title={filename}
                              >
                                {filename}
                              </span>
                              <span className="block text-[11px] text-slate-500">
                                Selected files will be sent within provider limits.
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="space-y-1">
          <label
            htmlFor={`quote-message-body-${quoteId}`}
            className="text-sm font-medium text-slate-200"
          >
            Message
          </label>
          <textarea
            id={`quote-message-body-${quoteId}`}
            name="body"
            ref={textareaRef}
            rows={4}
            maxLength={maxLen}
            placeholder="Share updates, blockers, or questions with the group..."
            className="w-full rounded-xl border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
            onChange={() => {
              // Clear "failed" status as soon as the user edits the draft.
              onOptimisticMessageChange?.((current) => {
                const optimistic = readOptimisticMeta(current);
                if (!optimistic || optimistic.status !== "failed") return current;
                return {
                  ...current!,
                  body: (textareaRef.current?.value ?? "").trim(),
                  metadata: { ...(current as any)?.metadata, status: "sending" },
                };
              });
            }}
          />
          {bodyError ? (
            <p className="text-sm text-red-300" role="alert">
              {bodyError}
            </p>
          ) : null}
        </div>
        {showSendFailure ? (
          <ComposerRetryInline />
        ) : null}
        <ComposerSubmitButton />
      </form>
    </div>
  );
}

function QuoteMessageSuggestionsRow({ quoteId }: { quoteId: string }) {
  const suggestions = useMemo(
    () => [
      {
        key: "tolerance",
        label: "Request tolerance change",
        ariaLabel: "Insert a template to request a tolerance change",
        template: [
          "Could we adjust the tolerance on this part/feature?",
          "",
          "Current tolerance: ____",
          "Requested tolerance: ____",
          "",
          "Please confirm feasibility and any impact on cost or lead time.",
        ].join("\n"),
      },
      {
        key: "material",
        label: "Confirm material/finish",
        ariaLabel: "Insert a template to confirm material and finish",
        template: [
          "Can you confirm the material and finish for this quote?",
          "",
          "Material: ____",
          "Finish/coating: ____",
          "",
          "If there are recommended alternatives, please share them.",
        ].join("\n"),
      },
      {
        key: "lead-time",
        label: "Ask about lead time",
        ariaLabel: "Insert a template to ask about lead time",
        template: [
          "What lead time should we plan for from order to ship?",
          "",
          "If there are options to expedite (and the impact), please let us know.",
        ].join("\n"),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-900/60 bg-slate-950/30 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Suggestions
      </p>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.key}
            type="button"
            aria-label={suggestion.ariaLabel}
            className="inline-flex items-center justify-center rounded-full border border-slate-800 bg-black/30 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:bg-black/40 hover:text-white"
            onClick={() => {
              prefillQuoteMessageComposerTextarea(quoteId, suggestion.template);
            }}
          >
            {suggestion.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ComposerSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center rounded-full bg-emerald-400 px-4 py-1.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
    >
      {pending ? "Sending..." : "Send message"}
    </button>
  );
}

function ComposerSendFailureRow() {
  return (
    <p
      className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-4 py-2.5 text-sm text-slate-200"
      role="status"
      aria-live="polite"
    >
      Couldn&apos;t send. Try again.
    </p>
  );
}

function ComposerRetryInline() {
  const { pending } = useFormStatus();

  // This component renders inside the <form>, so "Retry" can be a submit button
  // that respects `pending` and doesn't introduce a second optimistic message.
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
      <span>Couldn&apos;t send.</span>
      <button
        type="submit"
        disabled={pending}
        className="font-semibold text-slate-200 underline underline-offset-4 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        Retry
      </button>
    </div>
  );
}

function resolveRoleLabel(role: string | null | undefined): string {
  const normalized = (role ?? "").toLowerCase();
  if (normalized === "customer") {
    return "Customer";
  }
  if (normalized === "supplier") {
    return "Supplier";
  }
  if (normalized === "system") {
    return "System";
  }
  return "Admin";
}

function resolveRoleClasses(
  isCurrentUser: boolean,
  role: string | null | undefined,
): string {
  if (isCurrentUser) {
    return "bg-emerald-400/20 text-emerald-200 border border-emerald-400/40";
  }
  const normalized = (role ?? "").toLowerCase();
  if (normalized === "customer") {
    return "bg-blue-400/20 text-blue-200 border border-blue-400/40";
  }
  if (normalized === "supplier") {
    return "bg-purple-400/20 text-purple-200 border border-purple-400/40";
  }
  if (normalized === "system") {
    return "bg-amber-400/15 text-amber-200 border border-amber-400/30";
  }
  return "bg-slate-800 text-slate-100 border border-slate-700";
}

function sortMessages(messages: QuoteMessageRecord[]): QuoteMessageRecord[] {
  return [...messages].sort((a, b) => {
    const aTime = Date.parse(a.created_at);
    const bTime = Date.parse(b.created_at);
    if (!Number.isNaN(aTime) && !Number.isNaN(bTime)) {
      return aTime - bTime;
    }
    if (!Number.isNaN(aTime)) {
      return -1;
    }
    if (!Number.isNaN(bTime)) {
      return 1;
    }
    return a.id.localeCompare(b.id);
  });
}

function mergeMessages(
  existing: QuoteMessageRecord[],
  next: QuoteMessageRecord,
): QuoteMessageRecord[] {
  const deduped = existing.some((message) => message.id === next.id)
    ? existing.map((message) => (message.id === next.id ? next : message))
    : [...existing, next];
  return sortMessages(deduped);
}

function resolveQuoteMessageComposerTextareaId(quoteId: string) {
  return `quote-message-body-${quoteId}`;
}

function focusQuoteMessageComposerTextarea(quoteId: string) {
  if (typeof document === "undefined") return;
  try {
    const textarea = document.getElementById(
      resolveQuoteMessageComposerTextareaId(quoteId),
    ) as HTMLTextAreaElement | null;
    textarea?.focus();
  } catch {
    // Fail silently (best-effort UI enhancement).
  }
}

function prefillQuoteMessageComposerTextarea(quoteId: string, template: string) {
  if (typeof document === "undefined") return;
  try {
    const textarea = document.getElementById(
      resolveQuoteMessageComposerTextareaId(quoteId),
    ) as HTMLTextAreaElement | null;
    if (!textarea) return;

    const currentValue = textarea.value ?? "";
    const start = typeof textarea.selectionStart === "number" ? textarea.selectionStart : currentValue.length;
    const end = typeof textarea.selectionEnd === "number" ? textarea.selectionEnd : currentValue.length;

    const before = currentValue.slice(0, start);
    const after = currentValue.slice(end);

    const needsSpacerBefore = before.length > 0 && !before.endsWith("\n");
    const needsSpacerAfter = after.length > 0 && !after.startsWith("\n");

    const nextValue = [
      before,
      needsSpacerBefore ? "\n\n" : "",
      template,
      needsSpacerAfter ? "\n\n" : "",
      after,
    ].join("");

    textarea.value = nextValue;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.focus();
    const cursor = before.length + (needsSpacerBefore ? 2 : 0) + template.length;
    textarea.setSelectionRange(cursor, cursor);
  } catch {
    // Fail silently (best-effort UI enhancement).
  }
}

function useQuoteMessagesRealtime(
  quoteId: string,
  initialMessages: QuoteMessageRecord[],
): QuoteMessageRecord[] {
  const [messages, setMessages] = useState<QuoteMessageRecord[]>(
    () => sortMessages(initialMessages),
  );

  useEffect(() => {
    setMessages(sortMessages(initialMessages));
  }, [initialMessages, quoteId]);

  useEffect(() => {
    if (!quoteId) {
      return;
    }
    const client = getRealtimeClient();
    if (!client) {
      return;
    }

    const channel = client
      .channel(`quote_messages:${quoteId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "quote_messages",
          filter: `quote_id=eq.${quoteId}`,
        },
        (payload) => {
          const next = payload.new as QuoteMessageRecord | null;
          if (!next || next.quote_id !== quoteId) {
            return;
          }
          // Defense-in-depth: never allow real emails into the UI model.
          const sanitized: QuoteMessageRecord = {
            ...next,
            sender_email: null,
          };
          setMessages((current) => mergeMessages(current, sanitized));
        },
      );

    channel.subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [quoteId]);

  return messages;
}

let cachedClient: SupabaseClient | null = null;

function getRealtimeClient(): SupabaseClient | null {
  if (!cachedClient) {
    try {
      cachedClient = supabaseBrowser();
    } catch {
      cachedClient = null;
    }
  }
  return cachedClient;
}

function makeOptimisticMessageId(quoteId: string): string {
  const base = typeof quoteId === "string" ? quoteId.trim() : "";
  const nonce =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `optimistic:${base || "quote"}:${nonce}`;
}

function readOptimisticMeta(
  message: QuoteMessageRecord | null | undefined,
): null | { status: "sending" | "failed" } {
  const meta = (message as any)?.metadata;
  if (!meta || typeof meta !== "object") return null;
  if ((meta as any)?._optimistic !== true) return null;
  const raw = (meta as any)?.status;
  const status = raw === "failed" ? "failed" : "sending";
  return { status };
}
