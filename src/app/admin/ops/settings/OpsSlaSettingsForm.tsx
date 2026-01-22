"use client";

import clsx from "clsx";
import { useFormState, useFormStatus } from "react-dom";
import { primaryCtaClasses } from "@/lib/ctas";
import { formatDateTime } from "@/lib/formatDate";
import type { SlaConfig } from "@/lib/ops/sla";
import {
  saveOpsSlaSettingsAction,
  type OpsSlaSettingsFormState,
} from "./actions";

type OpsSlaSettingsFormProps = {
  initialConfig: SlaConfig;
  messageReplyMaxHours: number;
  updatedAt: string | null;
  usingFallback: boolean;
  messageReplyUsingFallback: boolean;
};

const INITIAL_STATE: OpsSlaSettingsFormState = {
  ok: true,
  message: "",
};

export function OpsSlaSettingsForm({
  initialConfig,
  messageReplyMaxHours,
  updatedAt,
  usingFallback,
  messageReplyUsingFallback,
}: OpsSlaSettingsFormProps) {
  const [state, formAction] = useFormState<
    OpsSlaSettingsFormState,
    FormData
  >(saveOpsSlaSettingsAction, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-6">
      <StatusMessage state={state} />
      {usingFallback ? (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Defaults are in use because the ops settings table is missing.
        </p>
      ) : null}
      {!usingFallback && messageReplyUsingFallback ? (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-100">
          Message reply SLA is using defaults because `ops_settings.message_reply_max_hours` is missing.
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <NumberField
          id="queuedMaxHours"
          name="queuedMaxHours"
          label="Queued max hours"
          description="How long a queued destination can sit before it needs action."
          defaultValue={initialConfig.queuedMaxHours}
          error={state.fieldErrors?.queuedMaxHours}
        />
        <NumberField
          id="sentNoReplyMaxHours"
          name="sentNoReplyMaxHours"
          label="Sent no-reply max hours"
          description="How long after sending before a destination needs a reply."
          defaultValue={initialConfig.sentNoReplyMaxHours}
          error={state.fieldErrors?.sentNoReplyMaxHours}
        />
        <NumberField
          id="messageReplyMaxHours"
          name="messageReplyMaxHours"
          label="Message reply max hours"
          description="How long an unanswered customer↔supplier message can sit before it’s overdue (internal)."
          defaultValue={messageReplyMaxHours}
          error={state.fieldErrors?.messageReplyMaxHours}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          Last updated: {formatDateTime(updatedAt, { includeTime: true })}
        </p>
        <SaveButton />
      </div>
    </form>
  );
}

function StatusMessage({ state }: { state: OpsSlaSettingsFormState }) {
  if (!state) return null;

  if (!state.ok && state.error) {
    return (
      <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
        {state.error}
      </p>
    );
  }

  if (state.ok && state.message) {
    return (
      <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
        {state.message}
      </p>
    );
  }

  return null;
}

type NumberFieldProps = {
  id: string;
  name: string;
  label: string;
  description: string;
  defaultValue: number;
  error?: string;
};

function NumberField({
  id,
  name,
  label,
  description,
  defaultValue,
  error,
}: NumberFieldProps) {
  return (
    <div className="space-y-2 rounded-2xl border border-slate-900/60 bg-slate-950/40 px-4 py-4">
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type="number"
        min={0}
        step={1}
        defaultValue={defaultValue}
        className={clsx(
          "w-full rounded-xl border bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none",
          error ? "border-red-500/60" : "border-slate-800",
        )}
      />
      <p className="text-xs text-slate-500">{description}</p>
      {error ? <p className="text-xs text-red-200">{error}</p> : null}
    </div>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={primaryCtaClasses}
      disabled={pending}
    >
      {pending ? "Saving..." : "Save settings"}
    </button>
  );
}
