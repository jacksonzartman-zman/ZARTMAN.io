"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  postSupplierQuoteMessageAction,
  type PostSupplierQuoteMessageState,
} from "./actions";
import { ctaSizeClasses, primaryCtaClasses } from "@/lib/ctas";

type SupplierQuoteMessageComposerProps = {
  quoteId: string;
  supplierEmail: string;
};

const INITIAL_STATE: PostSupplierQuoteMessageState = {
  success: false,
  error: null,
};

export function SupplierQuoteMessageComposer({
  quoteId,
  supplierEmail,
}: SupplierQuoteMessageComposerProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [state, formAction] = useFormState<
    PostSupplierQuoteMessageState,
    FormData
  >(postSupplierQuoteMessageAction, INITIAL_STATE);

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
      <input type="hidden" name="identity_email" value={supplierEmail} />
      <div className="space-y-1">
        <label
          htmlFor="supplier-quote-message-body"
          className="text-sm font-medium text-slate-200"
        >
          Message
        </label>
        <textarea
          id="supplier-quote-message-body"
          name="body"
          ref={textareaRef}
          rows={4}
          maxLength={2000}
          className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-400 focus:outline-none"
          placeholder="Share build progress, questions, or risks with the Zartman team..."
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
      className={`${primaryCtaClasses} ${ctaSizeClasses.md} w-full sm:w-auto`}
    >
      {pending ? "Sending..." : "Send update"}
    </button>
  );
}
