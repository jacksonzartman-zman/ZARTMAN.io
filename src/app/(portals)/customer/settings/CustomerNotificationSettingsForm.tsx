"use client";

import { useFormState, useFormStatus } from "react-dom";
import clsx from "clsx";
import { CUSTOMER_NOTIFICATION_OPTIONS } from "@/constants/notificationPreferences";
import { primaryCtaClasses } from "@/lib/ctas";
import {
  submitCustomerNotificationSettingsAction,
  type CustomerNotificationSettingsFormState,
} from "./actions";

type NotificationSettingsValues = Record<string, boolean>;

type CustomerNotificationSettingsFormProps = {
  initialValues: NotificationSettingsValues;
  disabled?: boolean;
};

const INITIAL_STATE: CustomerNotificationSettingsFormState = {
  ok: true,
  message: "",
};

export function CustomerNotificationSettingsForm({
  initialValues,
  disabled = false,
}: CustomerNotificationSettingsFormProps) {
  const [state, formAction] = useFormState<
    CustomerNotificationSettingsFormState,
    FormData
  >(submitCustomerNotificationSettingsAction, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-5">
      <StatusMessage state={state} />
      <fieldset className="space-y-4" disabled={disabled}>
        {CUSTOMER_NOTIFICATION_OPTIONS.map((option) => (
          <NotificationToggle
            key={option.eventType}
            id={`customer-${option.eventType}`}
            name={option.inputName}
            label={option.label}
            description={option.description}
            defaultChecked={initialValues[option.eventType] ?? true}
          />
        ))}
      </fieldset>
      <SaveButton disabled={disabled} />
    </form>
  );
}

function StatusMessage({
  state,
}: {
  state: CustomerNotificationSettingsFormState;
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
      <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-3 text-sm text-emerald-100">
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
        className="mt-1 h-4 w-4 rounded border-slate-700 bg-slate-950 text-emerald-400 focus:ring-emerald-300"
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
