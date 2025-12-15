"use client";

import { useMemo } from "react";
import { useFormState, useFormStatus } from "react-dom";
import clsx from "clsx";
import { primaryCtaClasses } from "@/lib/ctas";
import {
  submitSupplierCapacitySettings,
  type SupplierCapacitySettingsFormState,
} from "@/app/(portals)/supplier/settings/capacity/actions";

const CAPABILITY_OPTIONS = [
  { key: "cnc_mill", label: "CNC Mill" },
  { key: "cnc_lathe", label: "CNC Lathe" },
  { key: "mjp", label: "MJP" },
  { key: "sla", label: "SLA" },
] as const;

const LEVEL_OPTIONS = [
  { key: "", label: "Not set" },
  { key: "low", label: "Low" },
  { key: "medium", label: "Medium" },
  { key: "high", label: "High" },
  { key: "overloaded", label: "Overloaded" },
] as const;

export type SupplierCapacityEditorValues = Partial<
  Record<(typeof CAPABILITY_OPTIONS)[number]["key"], { level?: string | null; notes?: string | null }>
>;

const INITIAL_STATE: SupplierCapacitySettingsFormState = { ok: true, message: "" };

export function SupplierCapacityEditor({
  weekStartDate,
  initialValues,
}: {
  weekStartDate: string; // YYYY-MM-DD
  initialValues?: SupplierCapacityEditorValues;
}) {
  const [state, formAction] = useFormState<SupplierCapacitySettingsFormState, FormData>(
    submitSupplierCapacitySettings,
    INITIAL_STATE,
  );

  const initial = useMemo(() => initialValues ?? {}, [initialValues]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="weekStartDate" value={weekStartDate} />

      {state && !state.ok && state.error ? (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {state.error}
        </p>
      ) : null}
      {state && state.ok && state.message ? (
        <p className="rounded-xl border border-blue-500/40 bg-blue-500/10 px-4 py-3 text-sm text-blue-100">
          {state.message}
        </p>
      ) : null}

      <div className="space-y-3">
        {CAPABILITY_OPTIONS.map((capability) => {
          const defaultLevel = initial[capability.key]?.level ?? "";
          const defaultNotes = initial[capability.key]?.notes ?? "";

          return (
            <div
              key={capability.key}
              className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-4 py-3 space-y-3"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {capability.label}
                </span>
              </div>

              <label className="flex flex-col gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Capacity level
                </span>
                <select
                  name={`capacity_${capability.key}`}
                  defaultValue={defaultLevel}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-blue-400 focus:outline-none"
                >
                  {LEVEL_OPTIONS.map((level) => (
                    <option key={level.key} value={level.key}>
                      {level.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Notes (optional)
                </span>
                <textarea
                  name={`notes_${capability.key}`}
                  defaultValue={defaultNotes}
                  rows={2}
                  placeholder="Optional context for this week (constraints, shifts, planned downtime, etc.)"
                  className="w-full resize-none rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-blue-400 focus:outline-none"
                />
              </label>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-400">
          Advisory only. Saving emits a capacity update event for admins.
        </p>
        <SaveButton />
      </div>
    </form>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={clsx(primaryCtaClasses, "px-4 py-2 text-sm", pending ? "opacity-60" : "")}
    >
      {pending ? "Saving..." : "Save"}
    </button>
  );
}

