"use client";

import { useMemo, useState } from "react";
import { useFormState } from "react-dom";
import clsx from "clsx";

import type { QuoteMessageRow } from "@/server/quotes/messages";
import { submitSupplierQuoteMessageAction } from "./actions";
import { INITIAL_SUPPLIER_MESSAGE_STATE } from "@/lib/supplier/messages";

type SupplierQuoteMessagesCardProps = {
  quoteId: string;
  messages: QuoteMessageRow[];
  messagesUnavailable?: boolean;
  messagingUnlocked: boolean;
  disableReason?: string | null;
};

export function SupplierQuoteMessagesCard({
  quoteId,
  messages,
  messagesUnavailable = false,
  messagingUnlocked,
  disableReason,
}: SupplierQuoteMessagesCardProps) {
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const boundAction = useMemo(
    () => submitSupplierQuoteMessageAction.bind(null, quoteId),
    [quoteId],
  );

  const [rawState, formAction] = useFormState(
    boundAction,
    INITIAL_SUPPLIER_MESSAGE_STATE,
  );

  const state = useMemo(() => {
    return {
      ok: rawState.ok,
      message: rawState.message ?? "",
      error: rawState.error ?? "",
      fieldErrors: rawState.fieldErrors ?? {},
    };
  }, [rawState]);

  const showError = hasSubmitted && !state.ok && Boolean(state.error);
  const showSuccess = hasSubmitted && state.ok && Boolean(state.message);

  const handleSubmit = (formData: FormData) => {
    setHasSubmitted(true);
    return formAction(formData);
  };

  const disabled = !messagingUnlocked || messagesUnavailable;

  return (
    <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/60 px-6 py-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Messages
        </p>
        <h2 className="mt-1 text-xl font-semibold text-white heading-tight">
          Shared chat
        </h2>
        <p className="mt-1 text-sm text-slate-300">
          Direct line to the Zartman admin team for build updates and questions.
        </p>
      </header>

      {messagesUnavailable ? (
        <p className="text-xs text-slate-400">
          Messages are temporarily unavailable. Try reloading the page.
        </p>
      ) : messages.length === 0 ? (
        <p className="text-xs text-slate-400">
          No messages yet. You&apos;ll see customer and admin updates here once they post.
        </p>
      ) : (
        <ol className="space-y-3 text-sm">
          {messages.map((message) => (
            <li
              key={message.id}
              className="rounded-2xl border border-slate-800 bg-slate-950/40 px-5 py-4"
            >
              <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-500">
                <span
                  className={clsx(
                    "pill px-2.5 py-0.5 text-[10px]",
                    message.author_type === "customer"
                      ? "pill-success"
                      : message.author_type === "admin"
                        ? "pill-info"
                        : "pill-muted",
                  )}
                >
                  {message.author_type === "customer"
                    ? "Customer"
                    : message.author_type === "admin"
                      ? "Zartman.io"
                      : "Supplier"}
                </span>
                <span>{message.author_name}</span>
                <span>•</span>
                <span>{new Date(message.created_at).toLocaleString()}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-slate-100">
                {message.body}
              </p>
            </li>
          ))}
        </ol>
      )}

      <div className="space-y-2 border-t border-slate-900/60 pt-3">
        <p className="text-xs font-medium text-slate-400">Post a message</p>
        <p className="text-[11px] text-slate-500">
          Your message notifies the Zartman admin team instantly.
        </p>

        {showError && (
          <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-xs text-red-200">
            {state.error}
          </p>
        )}
        {showSuccess && (
          <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-200">
            {state.message}
          </p>
        )}

        {!messagingUnlocked && (
          <p className="text-xs text-slate-500">
            {disableReason ??
              "Chat unlocks after your bid is accepted for this RFQ."}
          </p>
        )}

        <form action={handleSubmit} className="mt-1 space-y-2">
          <textarea
            name="body"
            rows={3}
            className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none ring-emerald-500/50 focus:border-emerald-500/60 focus:ring-1 disabled:cursor-not-allowed disabled:opacity-60"
            placeholder="Share build progress, questions, or risks with the Zartman team..."
            disabled={disabled}
          />
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-full bg-emerald-400 px-4 py-1.5 text-sm font-semibold text-slate-950 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
          >
            Send update
          </button>
        </form>
      </div>
    </section>
  );
}
