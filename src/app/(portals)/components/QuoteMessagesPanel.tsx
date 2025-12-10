"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import clsx from "clsx";

import { formatDateTime } from "@/lib/formatDate";
import type { QuoteThread, QuoteMessageRole } from "@/server/messages/quoteThreads";
import {
  submitCustomerQuoteMessageAction,
} from "@/app/(portals)/customer/quotes/[id]/actions";
import {
  submitSupplierQuoteMessageAction,
} from "@/app/(portals)/supplier/quotes/[id]/actions";
import {
  submitAdminQuoteMessageAction,
} from "@/app/admin/quotes/[id]/actions";

type QuoteMessageFormState = {
  ok: boolean;
  message?: string | null;
  error?: string | null;
  fieldErrors?: {
    body?: string;
  };
};

type QuoteMessageComposerMode = "customer" | "supplier" | "admin";

type QuoteMessagesComposerConfig = {
  quoteId: string;
  mode: QuoteMessageComposerMode;
  disabled?: boolean;
  disableReason?: string | null;
  readOnly?: boolean;
  helperText?: string;
  placeholder?: string;
  sendLabel?: string;
  pendingLabel?: string;
};

type QuoteMessagesPanelProps = {
  thread: QuoteThread;
  viewerRole: QuoteMessageRole;
  className?: string;
  heading?: string;
  description?: string;
  helperText?: string;
  messagesUnavailable?: boolean;
  emptyState?: string;
  composer?: QuoteMessagesComposerConfig | null;
};

const DEFAULT_FORM_STATE: QuoteMessageFormState = {
  ok: true,
  message: "",
  error: "",
  fieldErrors: {},
};

const ACTION_BY_MODE: Record<
  QuoteMessageComposerMode,
  (
    quoteId: string,
    prevState: QuoteMessageFormState,
    formData: FormData,
  ) => Promise<QuoteMessageFormState>
> = {
  customer: submitCustomerQuoteMessageAction,
  supplier: submitSupplierQuoteMessageAction,
  admin: submitAdminQuoteMessageAction,
};

const PILL_CLASSES: Record<QuoteMessageRole, string> = {
  customer: "pill-success",
  supplier: "pill-muted",
  admin: "pill-info",
};

const ROLE_LABELS: Record<QuoteMessageRole, string> = {
  customer: "Customer",
  supplier: "Supplier",
  admin: "Zartman",
};

export function QuoteMessagesPanel({
  thread,
  viewerRole,
  className,
  heading = "Messages",
  description = "Shared updates for everyone on this RFQ.",
  helperText,
  messagesUnavailable = false,
  emptyState = "No messages yet. Use this space to coordinate build updates and questions.",
  composer = null,
}: QuoteMessagesPanelProps) {
  const hasMessages = thread.messages.length > 0;

  return (
    <section
      className={clsx(
        "space-y-4 rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-5",
        className,
      )}
    >
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Shared thread
        </p>
        <div>
          <h2 className="text-xl font-semibold text-white heading-tight">
            {heading}
          </h2>
          <p className="text-sm text-slate-400">{description}</p>
        </div>
      </header>

      {messagesUnavailable ? (
        <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-5 py-3 text-sm text-yellow-100">
          Messages are temporarily unavailable. Refresh the page to try again.
        </p>
      ) : null}

      <MessageList
        viewerRole={viewerRole}
        hasMessages={hasMessages}
        emptyState={emptyState}
        thread={thread}
      />

      {composer ? (
        <QuoteMessageComposer
          config={composer}
          helperText={helperText}
          disabled={messagesUnavailable || composer.disabled}
        />
      ) : null}
    </section>
  );
}

type MessageListProps = {
  viewerRole: QuoteMessageRole;
  hasMessages: boolean;
  emptyState: string;
  thread: QuoteThread;
};

function MessageList({
  viewerRole,
  hasMessages,
  emptyState,
  thread,
}: MessageListProps) {
  if (!hasMessages) {
    return (
      <p className="rounded-2xl border border-dashed border-slate-800/70 bg-black/30 px-6 py-5 text-sm text-slate-400">
        {emptyState}
      </p>
    );
  }

  return (
    <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
      {thread.messages.map((message) => (
        <article
          key={message.id}
          className="rounded-2xl border border-slate-900/70 bg-slate-950/40 px-5 py-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <span
                className={clsx(
                  "pill px-2.5 py-0.5 text-[10px]",
                  PILL_CLASSES[message.role],
                )}
              >
                {message.role === viewerRole ? "You" : ROLE_LABELS[message.role]}
              </span>
              <span className="font-semibold text-slate-100">
                {message.displayName}
              </span>
            </div>
            <span>
              {formatDateTime(message.createdAt, { includeTime: true }) ??
                "Just now"}
            </span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
            {message.body}
          </p>
        </article>
      ))}
    </div>
  );
}

type QuoteMessageComposerProps = {
  config: QuoteMessagesComposerConfig;
  helperText?: string;
  disabled?: boolean;
};

function QuoteMessageComposer({
  config,
  helperText,
  disabled = false,
}: QuoteMessageComposerProps) {
  const actionImpl = ACTION_BY_MODE[config.mode];
  const boundAction = useMemo(
    () =>
      actionImpl.bind(null, config.quoteId) as (
        state: QuoteMessageFormState,
        formData: FormData,
      ) => Promise<QuoteMessageFormState>,
    [actionImpl, config.quoteId],
  );
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [state, formAction] = useFormState(boundAction, DEFAULT_FORM_STATE);

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
  const showSuccess = state.ok && Boolean(state.message);
  const showError = !state.ok && Boolean(state.error);
  const readOnly = Boolean(config.readOnly);

  return (
    <div className="space-y-3 border-t border-slate-900/60 pt-4">
      <div>
        <p className="text-sm font-semibold text-slate-100">Send a message</p>
        {helperText ? (
          <p className="text-xs text-slate-500">{helperText}</p>
        ) : null}
      </div>
      {readOnly ? (
        <p className="rounded-xl border border-dashed border-slate-800/70 bg-black/30 px-5 py-3 text-xs text-slate-400">
          Read-only preview. Switch back to your customer identity to reply.
        </p>
      ) : null}
      {config.disableReason ? (
        <p className="text-xs text-slate-500">{config.disableReason}</p>
      ) : null}
      {showError ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-200">
          {state.error}
        </p>
      ) : null}
      {showSuccess ? (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-100">
          {state.message}
        </p>
      ) : null}
      <form ref={formRef} action={formAction} className="space-y-3">
        <div className="space-y-1">
          <label
            htmlFor={`quote-message-body-${config.mode}`}
            className="text-sm font-medium text-slate-200"
          >
            Message
          </label>
          <textarea
            id={`quote-message-body-${config.mode}`}
            name="body"
            ref={textareaRef}
            rows={4}
            maxLength={2000}
            disabled={disabled || readOnly}
            placeholder={
              config.placeholder ??
              "Share updates, blockers, or questions with the group..."
            }
            className="w-full rounded-xl border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />
          {bodyError ? (
            <p className="text-sm text-red-300" role="alert">
              {bodyError}
            </p>
          ) : null}
        </div>
        <ComposerSubmitButton
          disabled={disabled || readOnly}
          sendLabel={config.sendLabel}
          pendingLabel={config.pendingLabel}
        />
      </form>
    </div>
  );
}

type ComposerSubmitButtonProps = {
  disabled?: boolean;
  sendLabel?: string;
  pendingLabel?: string;
};

function ComposerSubmitButton({
  disabled = false,
  sendLabel = "Send message",
  pendingLabel = "Sending...",
}: ComposerSubmitButtonProps) {
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;
  return (
    <button
      type="submit"
      disabled={isDisabled}
      className="inline-flex w-full items-center justify-center rounded-full bg-emerald-400 px-4 py-1.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
    >
      {pending ? pendingLabel : sendLabel}
    </button>
  );
}
