"use client";

import { useEffect, useId, useMemo, useState } from "react";

type ChangeType =
  | "design"
  | "quantity"
  | "timeline"
  | "shipping"
  | "files"
  | "other";

const CHANGE_TYPE_OPTIONS: Array<{ value: ChangeType; label: string }> = [
  { value: "design", label: "Design / spec change" },
  { value: "quantity", label: "Quantity change" },
  { value: "timeline", label: "Timeline / lead time change" },
  { value: "shipping", label: "Shipping / address change" },
  { value: "files", label: "File update (new CAD/drawings)" },
  { value: "other", label: "Other" },
];

export function RequestChangeScaffold({
  quoteId,
  messagesHref,
  disabled = false,
}: {
  quoteId: string;
  /**
   * Link that routes the customer into messages (`?tab=messages#messages`).
   * We keep this as a plain href (no router dependency) so this stays lightweight.
   */
  messagesHref: string;
  /** Use to disable change requests when the workspace is read-only. */
  disabled?: boolean;
}) {
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const bodyId = `${dialogId}-body`;

  const [open, setOpen] = useState(false);
  const [changeType, setChangeType] = useState<ChangeType>("design");
  const [notes, setNotes] = useState("");
  const [composerAvailable, setComposerAvailable] = useState<boolean>(false);

  const composerTextareaId = useMemo(() => `quote-message-body-${quoteId}`, [quoteId]);

  const changeTypeLabel = useMemo(() => {
    return (
      CHANGE_TYPE_OPTIONS.find((opt) => opt.value === changeType)?.label ??
      "Change request"
    );
  }, [changeType]);

  const draftBody = useMemo(() => {
    const trimmedNotes = notes.trim();
    return [
      `Change request: ${changeTypeLabel}`,
      "",
      trimmedNotes.length > 0 ? trimmedNotes : "(add details here)",
      "",
      // TODO(customer-change-request): include structured fields (parts/files impacted, desired ship date, etc.).
    ].join("\n");
  }, [changeTypeLabel, notes]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    setComposerAvailable(Boolean(document.getElementById(composerTextareaId)));
  }, [composerTextareaId, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const primaryDisabled = disabled || !composerAvailable;
  const primaryDisabledReason = disabled
    ? "Change requests are unavailable while viewing this quote in read-only mode."
    : !composerAvailable
      ? "Open Messages to draft this request."
      : null;

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 transition hover:border-emerald-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        Request change
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/70"
            aria-label="Close modal"
            onClick={() => setOpen(false)}
          />

          <div className="relative w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-2xl">
            <header className="space-y-1">
              <p
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
                id={titleId}
              >
                Request change
              </p>
              <p className="text-sm text-slate-300" id={bodyId}>
                This creates a draft message for the shared thread. It does not submit anything yet.
              </p>
            </header>

            <div className="mt-4 space-y-4">
              <div className="space-y-1">
                <label htmlFor={`${dialogId}-type`} className="text-sm font-medium text-slate-200">
                  Change type
                </label>
                <select
                  id={`${dialogId}-type`}
                  value={changeType}
                  onChange={(e) => setChangeType(e.target.value as ChangeType)}
                  className="w-full rounded-xl border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
                >
                  {CHANGE_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor={`${dialogId}-notes`} className="text-sm font-medium text-slate-200">
                  Notes
                </label>
                <textarea
                  id={`${dialogId}-notes`}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={5}
                  maxLength={2000}
                  placeholder="What should we change? Include any specifics: part numbers, quantities, target ship date, and file updates."
                  className="w-full rounded-xl border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
                />
                <p className="text-xs text-slate-500">
                  Tip: include which parts/files this impacts, and any updated target dates.
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-black/30 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Draft preview
                </p>
                <pre className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-100">
                  {draftBody}
                </pre>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex items-center justify-center rounded-full border border-slate-800 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-600 hover:text-white"
              >
                Cancel
              </button>

              <a
                href={messagesHref}
                onClick={() => setOpen(false)}
                className="inline-flex items-center justify-center rounded-full border border-slate-800 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-600 hover:text-white"
              >
                Open messages
              </a>

              <button
                type="button"
                disabled={primaryDisabled}
                onClick={() => {
                  // UI-only scaffold:
                  // - No API call, no DB write.
                  // - We only prefill the existing message composer (if present).
                  //
                  // TODO(customer-change-request): replace this with a real "create change request" flow:
                  // - persist a structured change request record
                  // - optionally auto-post into the thread (server action)
                  // - attach relevant metadata (quote parts/files) and notify assigned admins/suppliers
                  const textarea = document.getElementById(
                    composerTextareaId,
                  ) as HTMLTextAreaElement | null;

                  // Ensure the Messages section is opened (DisclosureSection listens to hash changes).
                  if (typeof window !== "undefined") {
                    window.location.hash = "#messages";
                    document.getElementById("messages")?.scrollIntoView({ behavior: "smooth" });
                  }

                  if (textarea) {
                    textarea.value = draftBody;
                    textarea.dispatchEvent(new Event("input", { bubbles: true }));
                    textarea.focus();
                  }

                  setOpen(false);
                }}
                className="inline-flex items-center justify-center rounded-full bg-emerald-400 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Draft message in thread
              </button>
            </div>

            {primaryDisabledReason ? (
              <p className="mt-2 text-xs text-slate-500">{primaryDisabledReason}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

