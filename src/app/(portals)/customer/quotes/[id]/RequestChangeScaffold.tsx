"use client";

import { useEffect, useId, useMemo, useState } from "react";

const CHANGE_REQUEST_SUBMITTED_EVENT = "zartman:change-request-submitted";

type UiChangeType =
  | "design"
  | "quantity"
  | "timeline"
  | "shipping"
  | "files"
  | "other";

type ApiChangeType =
  | "tolerance"
  | "material_finish"
  | "lead_time"
  | "shipping"
  | "revision";

function mapUiChangeTypeToApi(changeType: UiChangeType): ApiChangeType {
  // The API only accepts a canonical enum. Keep the UI labels friendly, but
  // only send values that the API validates.
  switch (changeType) {
    case "shipping":
      return "shipping";
    case "timeline":
      return "lead_time";
    case "design":
    case "quantity":
    case "files":
    case "other":
    default:
      return "revision";
  }
}

const CHANGE_TYPE_OPTIONS: Array<{ value: UiChangeType; label: string }> = [
  { value: "design", label: "Design / spec change" },
  { value: "quantity", label: "Quantity change" },
  { value: "timeline", label: "Timeline / lead time change" },
  { value: "shipping", label: "Shipping / address change" },
  { value: "files", label: "File update (new CAD/drawings)" },
  { value: "other", label: "Other" },
];

function getScrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined") return "auto";
  const prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return prefersReducedMotion ? "auto" : "smooth";
}

function scrollToIdWithHash(id: string) {
  if (typeof window === "undefined") return;
  const nextHash = `#${id}`;
  if (window.location.hash !== nextHash) {
    window.history.replaceState(null, "", nextHash);
    // `replaceState` doesn't emit `hashchange`, but some components (e.g.
    // collapsible panels) may rely on it to react to deep links.
    window.dispatchEvent(new Event("hashchange"));
  }
  document.getElementById(id)?.scrollIntoView({
    behavior: getScrollBehavior(),
    block: "start",
  });
}

export function RequestChangeScaffold({
  quoteId,
  messagesHref,
  scrollToMessagesOnOpen = false,
  disabled = false,
}: {
  quoteId: string;
  /**
   * Link that routes the customer into messages (`?tab=messages#messages`).
   * We keep this as a plain href (no router dependency) so this stays lightweight.
   */
  messagesHref: string;
  /**
   * If true, jump to the Messages section before opening the modal.
   * Useful when rendering this control outside the Messages section.
   */
  scrollToMessagesOnOpen?: boolean;
  /** Use to disable change requests when the workspace is read-only. */
  disabled?: boolean;
}) {
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const bodyId = `${dialogId}-body`;

  const [open, setOpen] = useState(false);
  const [changeType, setChangeType] = useState<UiChangeType>("design");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (submitting) return;
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, submitting]);

  useEffect(() => {
    if (!open) return;
    setError(null);
  }, [open]);

  const handleSubmit = async () => {
    if (disabled) return;
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const apiChangeType = mapUiChangeTypeToApi(changeType);
    console.log("[change-request] submit", {
      quoteId,
      changeType: apiChangeType,
      ...(apiChangeType !== changeType ? { uiChangeType: changeType } : null),
      notesLen: notes?.length ?? 0,
    });

    try {
      const res = await fetch("/api/change-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId, changeType: apiChangeType, notes }),
      });

      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        // ignore parse errors, handled below
      }

      const ok = (data as { ok?: unknown } | null)?.ok === true;
      if (!res.ok || !ok) {
        setError(
          "We couldn’t submit that change request. Please double-check the details and try again.",
        );
        return;
      }

      setOpen(false);
      // Notify the Messages thread to show a transient success banner (client-only).
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(CHANGE_REQUEST_SUBMITTED_EVENT));
      }
      // After a successful submission, take the customer back to Messages.
      requestAnimationFrame(() => {
        scrollToIdWithHash("messages");
      });
    } catch (e) {
      console.error("[change-request] submit failed", e);
      setError("We couldn’t submit that change request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (scrollToMessagesOnOpen && typeof window !== "undefined") {
            scrollToIdWithHash("messages");
            requestAnimationFrame(() => setOpen(true));
            return;
          }

          setOpen(true);
        }}
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
            onClick={() => {
              if (submitting) return;
              setOpen(false);
            }}
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
                Submit a change request, and we’ll coordinate next steps in Messages.
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
                  onChange={(e) => setChangeType(e.target.value as UiChangeType)}
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
                disabled={submitting}
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
                disabled={disabled || submitting}
                onClick={handleSubmit}
                className="inline-flex items-center justify-center rounded-full bg-emerald-400 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Submitting…" : "Request change"}
              </button>
            </div>

            {error ? (
              <p className="mt-2 text-xs text-rose-200" role="alert">
                {error}
              </p>
            ) : disabled ? (
              <p className="mt-2 text-xs text-slate-500">
                Change requests are unavailable while viewing this quote in read-only mode.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

