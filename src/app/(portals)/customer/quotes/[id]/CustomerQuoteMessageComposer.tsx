"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  postCustomerQuoteMessageAction,
  type PostCustomerQuoteMessageState,
} from "./actions";
import { ctaSizeClasses, primaryCtaClasses } from "@/lib/ctas";

type CustomerQuoteMessageComposerProps = {
  quoteId: string;
  customerName?: string | null;
  disabled?: boolean;
};

const INITIAL_STATE: PostCustomerQuoteMessageState = {
  success: false,
  error: null,
};

export function CustomerQuoteMessageComposer({
  quoteId,
  customerName,
  disabled = false,
}: CustomerQuoteMessageComposerProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [state, formAction] = useFormState<
    PostCustomerQuoteMessageState,
    FormData
  >(postCustomerQuoteMessageAction, INITIAL_STATE);

  useEffect(() => {
    if (!state.success) {
      return;
    }
    formRef.current?.reset();
    if (textareaRef.current) {
      textareaRef.current.value = "";
    }
  }, [state.success, state.messageId]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <input type="hidden" name="quote_id" value={quoteId} />
      <input type="hidden" name="author_name" value={customerName ?? ""} />
      <div className="space-y-1">
        <label
          htmlFor="customer-quote-message-body"
          className="text-sm font-medium text-slate-200"
        >
          Message
        </label>
        <textarea
          id="customer-quote-message-body"
          name="body"
          ref={textareaRef}
          rows={4}
          maxLength={2000}
          disabled={disabled}
          className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
          placeholder="Share files, timing updates, or questions for the Zartman team..."
        />
      </div>

      {state.error && (
        <p className="text-sm text-red-400" role="alert" aria-live="polite">
          {state.error}
        </p>
      )}

      <ComposerSubmitButton disabled={disabled} />
    </form>
  );
}

function ComposerSubmitButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={`${primaryCtaClasses} ${ctaSizeClasses.md} w-full sm:w-auto`}
    >
      {pending ? "Sending..." : "Send message"}
    </button>
  );
}
