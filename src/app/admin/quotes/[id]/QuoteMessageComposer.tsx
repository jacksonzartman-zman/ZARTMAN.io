"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  postQuoteMessageAction,
  type PostQuoteMessageActionState,
} from "./actions";
import { primaryCtaClasses } from "@/lib/ctas";

type QuoteMessageComposerProps = {
  quoteId: string;
};

const INITIAL_POST_QUOTE_MESSAGE_STATE: PostQuoteMessageActionState = {
  success: false,
  error: null,
};

export function QuoteMessageComposer({ quoteId }: QuoteMessageComposerProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [state, formAction] = useFormState<
    PostQuoteMessageActionState,
    FormData
  >(postQuoteMessageAction, INITIAL_POST_QUOTE_MESSAGE_STATE);

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
      <div className="space-y-1">
        <label
          htmlFor="quote-message-body"
          className="text-sm font-medium text-slate-200"
        >
          Message
        </label>
        <textarea
          id="quote-message-body"
          name="body"
          ref={textareaRef}
          rows={4}
          maxLength={2000}
          className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
          placeholder="Share an update or question for this quote..."
        />
      </div>

      {state.error && (
        <p className="text-sm text-red-400" role="alert" aria-live="polite">
          {state.error}
        </p>
      )}

      <ComposerSubmitButton />
    </form>
  );
}

function ComposerSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={`${primaryCtaClasses} w-full sm:w-auto`}
    >
      {pending ? "Sending..." : "Send message"}
    </button>
  );
}
