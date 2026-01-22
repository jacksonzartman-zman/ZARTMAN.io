"use client";

import clsx from "clsx";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ctaSizeClasses, secondaryCtaClasses } from "@/lib/ctas";

type IntroRequestsHandleButtonProps = {
  quoteId: string;
  providerIds: string[];
  providerLabelById?: Record<string, string>;
  actionClassName?: string;
};

export function IntroRequestsHandleButton({
  quoteId,
  providerIds,
  providerLabelById,
  actionClassName,
}: IntroRequestsHandleButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const normalizedProviderIds = useMemo(
    () => Array.from(new Set((Array.isArray(providerIds) ? providerIds : []).filter(Boolean))),
    [providerIds],
  );

  const canSubmit = Boolean(quoteId) && Boolean(selectedProviderId) && !pending;

  const openModal = () => {
    if (normalizedProviderIds.length === 0) return;
    setError(null);
    setNotes("");
    setSelectedProviderId(normalizedProviderIds[0] ?? "");
    setOpen(true);
  };

  const closeModal = () => {
    if (pending) return;
    setOpen(false);
  };

  const submit = () => {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/ops/intro-requests/mark-handled", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            quoteId,
            providerId: selectedProviderId,
            notes: notes.trim() || undefined,
          }),
        });

        const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
        if (!res.ok || !json?.ok) {
          setError(json?.error || "Unable to mark handled.");
          return;
        }

        setOpen(false);
        router.refresh();
      } catch {
        setError("Unable to mark handled.");
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={actionClassName ?? clsx(secondaryCtaClasses, ctaSizeClasses.sm)}
      >
        Mark handled
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
          role="dialog"
          aria-modal="true"
          aria-label="Mark intro handled"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
        >
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950/95 p-6 text-slate-100 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                  Intro request
                </p>
                <h3 className="mt-1 text-lg font-semibold text-white">Mark handled</h3>
                <p className="mt-1 text-sm text-slate-300">
                  This marks the request handled and records an ops event for audit.
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                disabled={pending}
                className={clsx(
                  "rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:text-white",
                  pending ? "cursor-not-allowed opacity-60" : "",
                )}
              >
                Close
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <label className="flex flex-col gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Provider
                </span>
                <select
                  value={selectedProviderId}
                  onChange={(e) => setSelectedProviderId(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                >
                  {normalizedProviderIds.map((providerId) => (
                    <option key={providerId} value={providerId}>
                      {(providerLabelById && providerLabelById[providerId]) || providerId}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Notes (optional)
                </span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  maxLength={2000}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                  placeholder="What did we do / who did we connect?"
                />
              </label>

              {error ? (
                <div className="rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                  {error}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={pending}
                  className={clsx(
                    secondaryCtaClasses,
                    ctaSizeClasses.sm,
                    pending ? "cursor-not-allowed opacity-60" : "",
                  )}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSubmit}
                  className={clsx(
                    "rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400",
                    !canSubmit ? "cursor-not-allowed opacity-60" : "",
                  )}
                >
                  {pending ? "Saving..." : "Mark handled"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

