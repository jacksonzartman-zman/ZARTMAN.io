"use client";

import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CustomerSearchActionsProps = {
  quoteId: string;
  sharePath: string;
  defaultEmail?: string | null;
};

type ShareStatus = "idle" | "copied" | "error";
type SaveStatus = "idle" | "saving" | "success" | "error";

const ACTION_BUTTON_CLASSES =
  "inline-flex items-center rounded-full border border-slate-700/70 bg-slate-950/40 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white";
const ACTION_BUTTON_DISABLED_CLASSES =
  "cursor-not-allowed border-slate-800/80 bg-slate-950/40 text-slate-500";
const SHARE_RESET_MS = 2200;

export function CustomerSearchActions({
  quoteId,
  sharePath,
  defaultEmail,
}: CustomerSearchActionsProps) {
  const [shareStatus, setShareStatus] = useState<ShareStatus>("idle");
  const [saveModalOpen, setSaveModalOpen] = useState(false);

  useEffect(() => {
    if (shareStatus === "idle") return;
    const timeout = window.setTimeout(() => setShareStatus("idle"), SHARE_RESET_MS);
    return () => window.clearTimeout(timeout);
  }, [shareStatus]);

  const shareLabel = useMemo(() => {
    if (shareStatus === "copied") return "Copied";
    if (shareStatus === "error") return "Copy failed";
    return "Share";
  }, [shareStatus]);

  const handleShare = useCallback(async () => {
    if (!sharePath) {
      setShareStatus("error");
      return;
    }
    const shareUrl = buildShareUrl(sharePath);
    const copied = await copyToClipboard(shareUrl);
    setShareStatus(copied ? "copied" : "error");
  }, [sharePath]);

  return (
    <>
      <button
        type="button"
        onClick={() => setSaveModalOpen(true)}
        className={ACTION_BUTTON_CLASSES}
      >
        Save this search
      </button>
      <button type="button" onClick={handleShare} className={ACTION_BUTTON_CLASSES}>
        {shareLabel}
      </button>
      <CustomerSearchSaveModal
        open={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        quoteId={quoteId}
        defaultEmail={defaultEmail}
      />
    </>
  );
}

type CustomerSearchSaveModalProps = {
  open: boolean;
  onClose: () => void;
  quoteId: string;
  defaultEmail?: string | null;
};

function CustomerSearchSaveModal({
  open,
  onClose,
  quoteId,
  defaultEmail,
}: CustomerSearchSaveModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [notifyOptIn, setNotifyOptIn] = useState(false);
  const [email, setEmail] = useState(normalizeEmail(defaultEmail));
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusableSelector =
      'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
    const raf = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      const firstFocusable = dialog?.querySelector<HTMLElement>(focusableSelector) ?? null;
      (firstFocusable ?? dialog)?.focus?.();
    });

    return () => {
      window.cancelAnimationFrame(raf);
      const previous = previouslyFocusedRef.current;
      if (previous && document.contains(previous)) {
        previous.focus();
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    setNotifyOptIn(false);
    setEmail(normalizeEmail(defaultEmail));
    setStatus("idle");
    setErrorMessage(null);
  }, [open, defaultEmail]);

  const normalizedEmail = email.trim().toLowerCase();
  const emailIsValid = notifyOptIn && normalizedEmail.length > 3 && normalizedEmail.includes("@");
  const isSaving = status === "saving";
  const isSuccess = status === "success";

  const notifyLabel = isSuccess ? "Saved" : isSaving ? "Saving..." : "Notify me";

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Save this search"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-800 bg-slate-950"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-900 px-6 py-4">
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm font-semibold text-white">Save this search</p>
            <p className="text-xs text-slate-400">Coming soon: saved searches + alerts.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close save search dialog"
            className="rounded-full border border-slate-700 bg-slate-900/30 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-100 transition hover:border-slate-600"
          >
            Close
          </button>
        </div>

        <div className="space-y-4 p-6">
          <p className="text-sm text-slate-200">
            We are building saved searches with optional alerts.
          </p>

          <label className="flex items-start gap-3 rounded-xl border border-slate-900/60 bg-slate-950/40 px-4 py-3">
            <input
              type="checkbox"
              checked={notifyOptIn}
              onChange={(event) => {
                setNotifyOptIn(event.target.checked);
                setStatus("idle");
                setErrorMessage(null);
              }}
              className="mt-0.5 h-4 w-4 rounded border-slate-700 bg-slate-950 text-emerald-400 focus:ring-emerald-300"
            />
            <span className="space-y-1">
              <span className="text-sm font-semibold text-white">Email me when it is ready</span>
              <span className="block text-xs text-slate-400">Optional. One heads-up.</span>
            </span>
          </label>

          {notifyOptIn ? (
            <label className="flex flex-col gap-2 text-xs font-semibold text-slate-300">
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                className="w-full rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-emerald-400"
              />
            </label>
          ) : null}

          {errorMessage ? (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
              {errorMessage}
            </p>
          ) : null}

          {isSuccess ? (
            <p className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
              Thanks! We will email you when saved searches are ready.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-700 bg-slate-900/30 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-100 transition hover:border-slate-600"
            >
              Close
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!notifyOptIn) {
                  onClose();
                  return;
                }
                if (!emailIsValid) {
                  setErrorMessage("Add a valid email to get notified.");
                  return;
                }
                setStatus("saving");
                setErrorMessage(null);
                try {
                  const res = await fetch("/api/portal/customer/saved-search-interest", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      quoteId,
                      email: normalizedEmail,
                    }),
                  });
                  const payload = (await res.json().catch(() => null)) as { ok?: boolean } | null;
                  if (!payload || payload.ok !== true) {
                    setStatus("error");
                    setErrorMessage("Could not save interest. Try again.");
                    return;
                  }
                  setStatus("success");
                } catch {
                  setStatus("error");
                  setErrorMessage("Could not save interest. Try again.");
                }
              }}
              disabled={!notifyOptIn || !emailIsValid || isSaving || isSuccess}
              className={clsx(
                ACTION_BUTTON_CLASSES,
                (!notifyOptIn || !emailIsValid || isSaving || isSuccess) &&
                  ACTION_BUTTON_DISABLED_CLASSES,
              )}
            >
              {notifyLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function buildShareUrl(path: string): string {
  if (typeof window === "undefined") return path;
  try {
    return new URL(path, window.location.origin).toString();
  } catch {
    return path;
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to legacy copy method.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand("copy");
    document.body.removeChild(textarea);
    return success;
  } catch {
    return false;
  }
}

function normalizeEmail(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.trim();
}
