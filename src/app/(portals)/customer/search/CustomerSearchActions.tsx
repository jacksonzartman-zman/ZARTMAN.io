"use client";

import Link from "next/link";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CustomerSearchActionsProps = {
  quoteId: string;
  sharePath: string;
  quoteLabel?: string | null;
};

type SaveStatus = "idle" | "saving" | "success" | "error";

const ACTION_BUTTON_CLASSES =
  "inline-flex items-center rounded-full border border-slate-700/70 bg-slate-950/40 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white";
const ACTION_BUTTON_DISABLED_CLASSES =
  "cursor-not-allowed border-slate-800/80 bg-slate-950/40 text-slate-500";
const MAX_LABEL_LENGTH = 120;
const TOAST_RESET_MS = 2400;

export function CustomerSearchActions({
  quoteId,
  sharePath,
  quoteLabel,
}: CustomerSearchActionsProps) {
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!toastMessage) return;
    const timeout = window.setTimeout(() => setToastMessage(null), TOAST_RESET_MS);
    return () => window.clearTimeout(timeout);
  }, [toastMessage]);

  const handleShare = useCallback(async () => {
    if (!sharePath) {
      setToastMessage("Unable to build share link.");
      return;
    }
    const nextUrl = buildShareUrl(sharePath);
    setShareUrl(nextUrl);

    const copied = await copyToClipboardPrimary(nextUrl);
    if (copied) {
      setToastMessage("Link copied.");
      setShareModalOpen(false);
      return;
    }

    // Safari/iOS can reject programmatic clipboard writes. Fall back to an input
    // modal where the URL is pre-selected for manual copy.
    setShareModalOpen(true);
  }, [sharePath]);

  return (
    <>
      <div className="flex flex-col items-start gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSaveModalOpen(true)}
            className={ACTION_BUTTON_CLASSES}
          >
            Save this search
          </button>
          <button type="button" onClick={handleShare} className={ACTION_BUTTON_CLASSES}>
            Share
          </button>
        </div>
        <p className="text-[11px] text-slate-500">
          Saved searches are private links you can share with teammates.
        </p>
      </div>
      <CustomerSearchSaveModal
        open={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        quoteId={quoteId}
        defaultLabel={quoteLabel}
      />

      <ShareLinkModal
        open={shareModalOpen}
        url={shareUrl}
        onClose={() => setShareModalOpen(false)}
        onCopied={() => {
          setToastMessage("Link copied.");
          setShareModalOpen(false);
        }}
      />

      <Toast message={toastMessage} />
    </>
  );
}

function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      className="fixed bottom-4 left-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2"
      role="status"
      aria-live="polite"
    >
      <div className="rounded-2xl border border-slate-800 bg-slate-950/95 px-4 py-3 text-sm font-semibold text-slate-100 shadow-[0_18px_45px_rgba(2,6,23,0.7)]">
        {message}
      </div>
    </div>
  );
}

function ShareLinkModal({
  open,
  url,
  onClose,
  onCopied,
}: {
  open: boolean;
  url: string;
  onClose: () => void;
  onCopied: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const raf = window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.select();
    });

    return () => {
      window.cancelAnimationFrame(raf);
      const prev = previouslyFocusedRef.current;
      if (prev && document.contains(prev)) prev.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setCopyError(null);
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Copy share link"
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
            <p className="truncate text-sm font-semibold text-white">Share link</p>
            <p className="text-xs text-slate-400">
              If your browser blocks clipboard access, select the link below and copy it.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share link dialog"
            className="rounded-full border border-slate-700 bg-slate-900/30 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-100 transition hover:border-slate-600"
          >
            Close
          </button>
        </div>

        <div className="space-y-4 p-6">
          <label className="flex flex-col gap-2 text-xs font-semibold text-slate-300">
            Link
            <input
              ref={inputRef}
              type="text"
              value={url}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-emerald-400"
            />
          </label>

          {copyError ? (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              {copyError}
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
                setCopyError(null);
                const input = inputRef.current;
                if (input) {
                  input.focus();
                  input.select();
                }
                const copied = await copyToClipboardPrimary(url);
                if (copied) {
                  onCopied();
                } else {
                  setCopyError("Select the link and copy it from the selection menu.");
                }
              }}
              disabled={!url.trim()}
              className={clsx(
                ACTION_BUTTON_CLASSES,
                (!url.trim() || false) && ACTION_BUTTON_DISABLED_CLASSES,
              )}
            >
              Copy link
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type CustomerSearchSaveModalProps = {
  open: boolean;
  onClose: () => void;
  quoteId: string;
  defaultLabel?: string | null;
};

function CustomerSearchSaveModal({
  open,
  onClose,
  quoteId,
  defaultLabel,
}: CustomerSearchSaveModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [label, setLabel] = useState(normalizeLabel(defaultLabel));
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
    setStatus("idle");
    setLabel(normalizeLabel(defaultLabel));
    setErrorMessage(null);
  }, [open, defaultLabel]);

  const trimmedLabel = label.trim();
  const labelIsValid = trimmedLabel.length > 0;
  const isSaving = status === "saving";
  const isSuccess = status === "success";

  const saveLabel = isSuccess ? "Saved" : isSaving ? "Saving..." : "Save search";

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
            <p className="text-xs text-slate-400">
              Save this search to revisit, share, or invite suppliers.
            </p>
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
            Add a short label and we will save a private link for you to revisit, share, or use when
            inviting suppliers.
          </p>

          <label className="flex flex-col gap-2 text-xs font-semibold text-slate-300">
            Label
            <input
              type="text"
              value={label}
              maxLength={MAX_LABEL_LENGTH}
              onChange={(event) => {
                setLabel(event.target.value);
                setStatus("idle");
                setErrorMessage(null);
              }}
              placeholder="Prototype suppliers"
              className="w-full rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-emerald-400"
            />
          </label>
          <p className="text-xs text-slate-500">
            Label helps you spot this search later.
          </p>

          {errorMessage ? (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
              {errorMessage}
            </p>
          ) : null}

          {isSuccess ? (
            <p className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
              Saved. Manage it in{" "}
              <Link href="/customer/saved" className="font-semibold text-emerald-100 underline">
                Saved searches
              </Link>
              .
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
                if (!labelIsValid) {
                  setErrorMessage("Add a short label to save this search.");
                  return;
                }
                setStatus("saving");
                setErrorMessage(null);
                try {
                  const res = await fetch("/api/portal/customer/saved-searches", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      quoteId,
                      label: trimmedLabel,
                    }),
                  });
                  const payload = (await res.json().catch(() => null)) as
                    | { ok?: boolean; error?: string }
                    | null;
                  if (!payload || payload.ok !== true) {
                    setStatus("error");
                    if (payload?.error === "unsupported") {
                      setErrorMessage("Saved searches are not available on this deployment yet.");
                    } else {
                      setErrorMessage("Could not save this search. Try again.");
                    }
                    return;
                  }
                  setStatus("success");
                } catch {
                  setStatus("error");
                  setErrorMessage("Could not save this search. Try again.");
                }
              }}
              disabled={!labelIsValid || isSaving || isSuccess}
              className={clsx(
                ACTION_BUTTON_CLASSES,
                (!labelIsValid || isSaving || isSuccess) && ACTION_BUTTON_DISABLED_CLASSES,
              )}
            >
              {saveLabel}
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

async function copyToClipboardPrimary(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Clipboard API can fail (Safari/iOS, permission, insecure context).
  }
  return false;
}

function normalizeLabel(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, MAX_LABEL_LENGTH);
}
