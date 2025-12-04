"use client";

import { useFormState, useFormStatus } from "react-dom";
import clsx from "clsx";
import { primaryCtaClasses } from "@/lib/ctas";
import {
  submitSupplierNotificationSettingsAction,
  type SupplierNotificationSettingsFormState,
} from "./actions";

type NotificationSettingsValues = {
  notifyQuoteMessages: boolean;
  notifyQuoteWinner: boolean;
};

type SupplierNotificationSettingsFormProps = {
  initialValues: NotificationSettingsValues;
  disabled?: boolean;
};

const INITIAL_STATE: SupplierNotificationSettingsFormState = {
  ok: true,
  message: "",
};

export function SupplierNotificationSettingsForm({
  initialValues,
  disabled = false,
}: SupplierNotificationSettingsFormProps) {
  const [state, formAction] = useFormState<
    SupplierNotificationSettingsFormState,
    FormData
  >(submitSupplierNotificationSettingsAction, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-5">
      <StatusMessage state={state} />
      <fieldset className="space-y-4" disabled={disabled}>
        <NotificationToggle
          id="supplier-notify-quote-messages"
          name="notify_quote_messages"
          label="New messages on accepted or won RFQs"
          description="We’ll ping you when customers or Zartman leave updates on awarded work."
          defaultChecked={initialValues.notifyQuoteMessages}
        />
        <NotificationToggle
          id="supplier-notify-quote-winner"
          name="notify_quote_winner"
          label="Customer selects a winning supplier (if it’s you)"
          description="Heads-up that you won the work so you can prep handoff."
          defaultChecked={initialValues.notifyQuoteWinner}
        />
      </fieldset>
      <SaveButton disabled={disabled} />
    </form>
  );
}

function StatusMessage({
  state,
}: {
  state: SupplierNotificationSettingsFormState;
}) {
  if (!state) {
    return null;
  }

  if (!state.ok && state.error) {
    return (
      <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-5 py-3 text-sm text-red-100">
        {state.error}
      </p>
    );
  }

  if (state.ok && state.message) {
    return (
      <p className="rounded-xl border border-blue-500/40 bg-blue-500/10 px-5 py-3 text-sm text-blue-100">
        {state.message}
      </p>
    );
  }

  return null;
}

type NotificationToggleProps = {
  id: string;
  name: string;
  label: string;
  description: string;
  defaultChecked: boolean;
};

function NotificationToggle({
  id,
  name,
  label,
  description,
  defaultChecked,
}: NotificationToggleProps) {
  return (
    <label
      htmlFor={id}
      className="flex items-start gap-4 rounded-2xl border border-slate-900/60 bg-slate-950/30 px-6 py-4"
    >
      <input
        id={id}
        name={name}
        type="checkbox"
        defaultChecked={defaultChecked}
        className="mt-1 h-4 w-4 rounded border-slate-700 bg-slate-950 text-blue-400 focus:ring-blue-200"
      />
      <span className="space-y-1">
        <span className="text-sm font-semibold text-white">{label}</span>
        <p className="text-xs text-slate-400">{description}</p>
      </span>
    </label>
  );
}

function SaveButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className={clsx(
        primaryCtaClasses,
        "px-5 py-2.5 text-sm",
        (disabled || pending) && "opacity-50",
      )}
    >
      {pending ? "Saving..." : "Save preferences"}
    </button>
  );
}
