"use client";

/**
 * Phase 1 Polish checklist
 * - Done: Empty state card (role-agnostic, calm guidance)
 * - Done: Success/error surfaces keep copy actionable
 * - Done: Sending state keeps perceived speed (no scary spinners)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import clsx from "clsx";
import type { SupabaseClient } from "@supabase/supabase-js";

import { formatDateTime } from "@/lib/formatDate";
import { sbBrowser } from "@/lib/supabase";
import type { QuoteMessageRecord } from "@/server/quotes/messages";
import type { QuoteMessageFormState } from "@/app/(portals)/components/QuoteMessagesThread.types";
import { EmptyStateCard } from "@/components/EmptyStateCard";

export type QuoteMessagesThreadProps = {
  quoteId: string;
  messages: QuoteMessageRecord[];
  canPost: boolean;
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
  postAction,
  currentUserId,
  markRead = false,
  className,
  title = "Messages",
  description = "Shared thread with your supplier and the Zartman team.",
  usageHint = "Use Messages for clarifications, change requests, and questions.",
  helperText,
  disabledCopy,
  emptyStateCopy = "No messages yet. Start the thread if you need clarification, want to request a change, or have a question—everyone on this workspace will be notified.",
}: QuoteMessagesThreadProps) {
  const realtimeMessages = useQuoteMessagesRealtime(quoteId, messages);
  const sortedMessages = useMemo(
    () => sortMessages(realtimeMessages),
    [realtimeMessages],
  );
  const composerEnabled = Boolean(postAction) && canPost;

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

  return (
    <section
      className={clsx(
        "space-y-5 rounded-2xl border border-slate-900 bg-slate-950/50 px-6 py-5",
        className,
      )}
    >
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Messages</p>
        <div>
          <h2 className="text-xl font-semibold text-white">{title}</h2>
          <p className="text-sm text-slate-400">{description}</p>
        </div>
        {usageHint ? (
          <p className="text-xs text-slate-500">{usageHint}</p>
        ) : null}
      </header>

      <QuoteMessageList
        messages={sortedMessages}
        currentUserId={currentUserId}
        emptyStateCopy={emptyStateCopy}
      />

      {composerEnabled && postAction ? (
        <QuoteMessageComposer
          quoteId={quoteId}
          postAction={postAction}
          helperText={helperText}
          disabledCopy={canPost ? null : disabledCopy}
        />
      ) : !canPost && disabledCopy ? (
        <p className="rounded-xl border border-dashed border-slate-800/70 bg-black/30 px-5 py-3 text-xs text-slate-400">
          {disabledCopy}
        </p>
      ) : null}
    </section>
  );
}

function QuoteMessageList({
  messages,
  currentUserId,
  emptyStateCopy,
}: {
  messages: QuoteMessageRecord[];
  currentUserId: string | null;
  emptyStateCopy: string;
}) {
  if (messages.length === 0) {
    return (
      <EmptyStateCard
        title="No messages yet"
        description={emptyStateCopy}
        className="px-6 py-5"
      />
    );
  }

  return (
    <div className="min-w-0 max-h-[28rem] space-y-3 overflow-y-auto pr-1">
      {messages.map((message) => {
        const isCurrentUser =
          typeof currentUserId === "string" &&
          message.sender_id === currentUserId;
        const roleLabel = resolveRoleLabel(message.sender_role);
        const displayLabel = isCurrentUser
          ? "You"
          : message.sender_name?.trim() ||
            message.sender_email?.trim() ||
            roleLabel;

        return (
          <article
            key={message.id}
            className={clsx(
              "rounded-2xl border px-5 py-4",
              isCurrentUser
                ? "border-emerald-500/40 bg-emerald-500/10"
                : "border-slate-900/70 bg-slate-950/40",
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
              </div>
              <span>
                {formatDateTime(message.created_at, { includeTime: true }) ??
                  "Just now"}
              </span>
            </div>
            <p className="break-anywhere mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
              {message.body}
            </p>
          </article>
        );
      })}
    </div>
  );
}

function QuoteMessageComposer({
  quoteId,
  postAction,
  helperText,
  disabledCopy,
}: {
  quoteId: string;
  postAction: (
    prevState: QuoteMessageFormState,
    formData: FormData,
  ) => Promise<QuoteMessageFormState>;
  helperText?: string;
  disabledCopy?: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [state, formAction] = useFormState(postAction, DEFAULT_FORM_STATE);

  useEffect(() => {
    if (!state.ok || !state.message) {
      return;
    }
    formRef.current?.reset();
    if (textareaRef.current) {
      textareaRef.current.value = "";
    }
  }, [state.ok, state.message]);

  const bodyError = state.fieldErrors?.body;

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
      {!state.ok && state.error ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-200">
          {state.error}
        </p>
      ) : null}
      {state.ok && state.message ? (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-100">
          {state.message}
        </p>
      ) : null}
      <form ref={formRef} action={formAction} className="space-y-3">
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
            maxLength={2000}
            placeholder="Share updates, blockers, or questions with the group..."
            className="w-full rounded-xl border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
          />
          {bodyError ? (
            <p className="text-sm text-red-300" role="alert">
              {bodyError}
            </p>
          ) : null}
        </div>
        <ComposerSubmitButton />
      </form>
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

function resolveRoleLabel(role: string | null | undefined): string {
  const normalized = (role ?? "").toLowerCase();
  if (normalized === "customer") {
    return "Customer";
  }
  if (normalized === "supplier") {
    return "Supplier";
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
          setMessages((current) => mergeMessages(current, next));
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
    cachedClient = sbBrowser();
  }
  return cachedClient;
}
