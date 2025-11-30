"use client";

import { forwardRef, useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { formatDateTime } from "@/lib/formatDate";
import { ctaSizeClasses, primaryCtaClasses } from "@/lib/ctas";
import type { QuoteMessage, QuoteMessageAuthorType } from "@/server/quotes/messages";
import {
  submitAdminQuoteMessageAction,
  type AdminMessageFormState,
} from "./actions";

const INITIAL_STATE: AdminMessageFormState = { ok: true };

const AUTHOR_LABELS: Record<QuoteMessageAuthorType, string> = {
  customer: "Customer",
  admin: "Zartman.io",
  supplier: "Supplier",
};

type AdminQuoteMessagesCardProps = {
  quoteId: string;
  messages: QuoteMessage[];
  messagesUnavailable?: boolean;
};

export function AdminQuoteMessagesCard({
  quoteId,
  messages,
  messagesUnavailable = false,
}: AdminQuoteMessagesCardProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const action = useMemo(
    () => submitAdminQuoteMessageAction.bind(null, quoteId),
    [quoteId],
  );
  const [state, formAction] = useFormState<AdminMessageFormState, FormData>(
    action,
    INITIAL_STATE,
  );

  useEffect(() => {
    if (!state.ok || !state.message) {
      return;
    }
    formRef.current?.reset();
    if (textareaRef.current) {
      textareaRef.current.value = "";
    }
  }, [state.ok, state.message]);

  const hasMessages = messages.length > 0;
  const disabled = messagesUnavailable;

  return (
    <section className="space-y-4 rounded-2xl border border-slate-900 bg-slate-950/60 p-4">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Customer messages
        </p>
        <div>
          <h2 className="text-lg font-semibold text-white">Customer messages</h2>
          <p className="text-sm text-slate-400">
            Use this thread to keep RFQ context in one place.
          </p>
        </div>
      </header>

      {messagesUnavailable ? (
        <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-sm text-yellow-100">
          Messages are temporarily unavailable. Refresh to try again.
        </p>
      ) : null}

      <AdminMessageList messages={messages} hasMessages={hasMessages} />

      <div className="space-y-3 border-t border-slate-900/60 pt-4">
        <div>
          <p className="text-sm font-semibold text-slate-100">Reply</p>
          <p className="text-xs text-slate-500">
            Visible to the requesting customer and Zartman admins.
          </p>
        </div>
        <AdminMessageComposerForm
          ref={formRef}
          textareaRef={textareaRef}
          onSubmit={formAction}
          state={state}
          disabled={disabled}
        />
      </div>
    </section>
  );
}

type AdminMessageListProps = {
  messages: QuoteMessage[];
  hasMessages: boolean;
};

function AdminMessageList({ messages, hasMessages }: AdminMessageListProps) {
  if (!hasMessages) {
    return (
      <p className="rounded-2xl border border-dashed border-slate-800/70 bg-black/30 px-4 py-4 text-sm text-slate-400">
        No messages yet. Reply here to keep the customer looped in.
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {messages.map((message) => (
        <li
          key={message.id}
          className="rounded-2xl border border-slate-900/70 bg-slate-950/40 px-4 py-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <span className="font-semibold text-slate-100">
              {AUTHOR_LABELS[message.author_type] ?? AUTHOR_LABELS.admin}
            </span>
            <span>
              {formatDateTime(message.created_at, { includeTime: true }) ?? ""}
            </span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
            {message.body}
          </p>
        </li>
      ))}
    </ol>
  );
}

type AdminMessageComposerFormProps = {
  onSubmit: (payload: FormData) => void;
  state: AdminMessageFormState;
  disabled?: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
};

const AdminMessageComposerForm = forwardRef<
  HTMLFormElement,
  AdminMessageComposerFormProps
>(({ onSubmit, state, disabled = false, textareaRef }, ref) => {
  const bodyError = state.fieldErrors?.body;
  const showSuccess = state.ok && Boolean(state.message);

  return (
    <form ref={ref} action={onSubmit} className="space-y-3">
      {showSuccess ? (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
          {state.message}
        </p>
      ) : null}
      {!state.ok && state.error ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {state.error}
        </p>
      ) : null}
      <div className="space-y-1">
        <label
          htmlFor="admin-quote-message-body"
          className="text-sm font-medium text-slate-200"
        >
          Message
        </label>
        <textarea
          id="admin-quote-message-body"
          name="body"
          ref={textareaRef}
          rows={4}
          maxLength={2000}
          disabled={disabled}
          className="w-full rounded-lg border border-slate-800 bg-black/30 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          placeholder="Share an update or ask a follow-up question..."
        />
        {bodyError ? (
          <p className="text-sm text-red-300" role="alert">
            {bodyError}
          </p>
        ) : null}
      </div>
      <AdminComposerSubmitButton disabled={disabled} />
    </form>
  );
});

AdminMessageComposerForm.displayName = "AdminQuoteMessageComposerForm";

type AdminComposerSubmitButtonProps = {
  disabled?: boolean;
};

function AdminComposerSubmitButton({ disabled }: AdminComposerSubmitButtonProps) {
  const { pending } = useFormStatus();
  const isDisabled = pending || disabled;
  return (
    <button
      type="submit"
      disabled={isDisabled}
      className={`${primaryCtaClasses} ${ctaSizeClasses.md} w-full sm:w-auto`}
    >
      {pending ? "Sending..." : "Reply"}
    </button>
  );
}
