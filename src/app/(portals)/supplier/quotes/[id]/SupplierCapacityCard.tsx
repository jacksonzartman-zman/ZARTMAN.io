"use client";

import { useMemo } from "react";
import { useFormState, useFormStatus } from "react-dom";
import clsx from "clsx";
import {
  submitSupplierCapacityNextWeek,
  type SupplierCapacityFormState,
} from "./actions";
import { primaryCtaClasses } from "@/lib/ctas";

const CAPABILITY_OPTIONS = [
  { key: "cnc_mill", label: "CNC Mill" },
  { key: "cnc_lathe", label: "CNC Lathe" },
  { key: "mjp", label: "MJP" },
  { key: "sla", label: "SLA" },
] as const;

const LEVEL_OPTIONS = [
  { key: "low", label: "Low" },
  { key: "medium", label: "Medium" },
  { key: "high", label: "High" },
  { key: "overloaded", label: "Overloaded" },
] as const;

const INITIAL_STATE: SupplierCapacityFormState = { ok: true, message: "" };

export function SupplierCapacityCard({
  quoteId,
  weekStartDate,
  initialLevels,
}: {
  quoteId: string;
  weekStartDate: string; // YYYY-MM-DD
  initialLevels?: Partial<Record<(typeof CAPABILITY_OPTIONS)[number]["key"], string>>;
}) {
  const [state, formAction] = useFormState<SupplierCapacityFormState, FormData>(
    submitSupplierCapacityNextWeek.bind(null, quoteId),
    INITIAL_STATE,
  );

  const initial = useMemo(() => initialLevels ?? {}, [initialLevels]);

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
          const defaultLevel = initial[capability.key] ?? "medium";
          return (
            <label
              key={capability.key}
              className="flex flex-col gap-2 rounded-2xl border border-slate-900/60 bg-slate-950/30 px-4 py-3"
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {capability.label}
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
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-400">
          Advisory only. Updates show up on the admin timeline.
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

