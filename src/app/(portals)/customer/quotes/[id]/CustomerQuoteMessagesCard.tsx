"use client";

import { forwardRef, useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { formatDateTime } from "@/lib/formatDate";
import { ctaSizeClasses, primaryCtaClasses } from "@/lib/ctas";
import type { QuoteMessage } from "@/server/quotes/messages";
import {
  submitCustomerQuoteMessageAction,
  type CustomerMessageFormState,
} from "./actions";

const INITIAL_STATE: CustomerMessageFormState = { ok: true };

type CustomerQuoteMessagesCardProps = {
  quoteId: string;
  messages: QuoteMessage[];
  messagesUnavailable?: boolean;
  readOnly?: boolean;
};

export function CustomerQuoteMessagesCard({
  quoteId,
  messages,
  messagesUnavailable = false,
  readOnly = false,
}: CustomerQuoteMessagesCardProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const action = useMemo(
    () => submitCustomerQuoteMessageAction.bind(null, quoteId),
    [quoteId],
  );
  const [state, formAction] = useFormState<CustomerMessageFormState, FormData>(
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

  const disabled = readOnly || messagesUnavailable;
  const hasMessages = messages.length > 0;

  return (
    <section className="space-y-4 rounded-2xl border border-slate-900 bg-slate-950/40 p-4">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Messages
        </p>
        <div>
          <h2 className="text-lg font-semibold text-white">Messages</h2>
          <p className="text-sm text-slate-400">
            Share clarifications and notes about this RFQ. Zartman.io will respond here.
          </p>
        </div>
      </header>

      {messagesUnavailable ? (
        <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-sm text-yellow-100">
          Messages are temporarily unavailable. Refresh the page or try again later.
        </p>
      ) : null}

      <MessageList messages={messages} hasMessages={hasMessages} />

      <div className="space-y-3 border-t border-slate-900/60 pt-4">
        <div>
          <p className="text-sm font-semibold text-slate-100">Send a message</p>
          <p className="text-xs text-slate-500">
            Shared with the Zartman.io team supporting this RFQ.
          </p>
        </div>
        {readOnly ? (
          <p className="rounded-xl border border-dashed border-slate-800/70 bg-black/30 px-3 py-2 text-xs text-slate-400">
            Read-only preview. Remove the email override to reply as the customer.
          </p>
        ) : null}
        <MessageComposerForm
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

type MessageListProps = {
  messages: QuoteMessage[];
  hasMessages: boolean;
};

function MessageList({ messages, hasMessages }: MessageListProps) {
  if (!hasMessages) {
    return (
      <p className="rounded-2xl border border-dashed border-slate-800/70 bg-black/30 px-4 py-4 text-sm text-slate-400">
        No messages yet. Use this space to share clarifications or notes about this RFQ.
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {messages.map((message) => {
        const label = message.author_type === "customer" ? "You" : "Zartman.io";
        return (
          <li
            key={message.id}
            className="rounded-2xl border border-slate-900/70 bg-slate-950/50 px-4 py-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
              <span className="font-semibold text-slate-100">{label}</span>
              <span>
                {formatDateTime(message.created_at, { includeTime: true }) ?? "Just now"}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
              {message.body}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

type MessageComposerFormProps = {
  onSubmit: (payload: FormData) => void;
  state: CustomerMessageFormState;
  disabled?: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
};

const MessageComposerForm = forwardRef<HTMLFormElement, MessageComposerFormProps>(
  ({ onSubmit, state, disabled = false, textareaRef }, ref) => {
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
          htmlFor="customer-message-body"
          className="text-sm font-medium text-slate-200"
        >
          Message
        </label>
        <textarea
          id="customer-message-body"
          name="body"
          ref={textareaRef}
          rows={4}
          maxLength={2000}
          disabled={disabled}
          className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          placeholder="Share files, timing updates, or questions for the Zartman team..."
        />
        {bodyError ? (
          <p className="text-sm text-red-300" role="alert">
            {bodyError}
          </p>
        ) : null}
      </div>
      <ComposerSubmitButton disabled={disabled} />
    </form>
  );
});

MessageComposerForm.displayName = "CustomerMessageComposerForm";

type ComposerSubmitButtonProps = {
  disabled?: boolean;
};

function ComposerSubmitButton({ disabled }: ComposerSubmitButtonProps) {
  const { pending } = useFormStatus();
  const isDisabled = pending || disabled;
  return (
    <button
      type="submit"
      disabled={isDisabled}
      className={`${primaryCtaClasses} ${ctaSizeClasses.md} w-full sm:w-auto`}
    >
      {pending ? "Sending..." : "Send message"}
    </button>
  );
}
