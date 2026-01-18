"use client";

import Link from "next/link";
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { formatDateTime } from "@/lib/formatDate";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";

type SavedSearchListItem = {
  quoteId: string;
  label: string;
  createdAt: string;
  lastViewedAt: string | null;
  lastActivityAt: string | null;
  summary: SavedSearchSummary;
};

type ActionStatus = "idle" | "saving" | "error";
type CopyStatus = "idle" | "copied" | "error";

type SavedSearchSummary = {
  process: string | null;
  quantity: string | null;
  needBy: string | null;
  locations: string[];
};

const ACTION_BUTTON_CLASSES =
  "inline-flex items-center rounded-full border border-slate-800 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-600 hover:text-white";
const ACTION_BUTTON_DISABLED_CLASSES =
  "cursor-not-allowed border-slate-900 text-slate-600";
const ACTION_DANGER_CLASSES =
  "border-red-500/40 text-red-200 hover:border-red-400 hover:text-white";
const INPUT_CLASSES =
  "w-full rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-emerald-400";
const MAX_LABEL_LENGTH = 120;
const COPY_RESET_MS = 2200;
const SUMMARY_CHIP_CLASSES =
  "inline-flex items-center gap-1 rounded-full border border-slate-800/70 bg-slate-950/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400";
const SUMMARY_VALUE_CLASSES =
  "inline-block max-w-[200px] truncate text-slate-100 normal-case tracking-normal";

export function SavedSearchesList({ searches }: { searches: SavedSearchListItem[] }) {
  if (searches.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        You have no saved searches yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {searches.map((search) => (
        <SavedSearchRow key={search.quoteId} search={search} />
      ))}
    </div>
  );
}

function SavedSearchRow({ search }: { search: SavedSearchListItem }) {
  const router = useRouter();
  const [isRenaming, setIsRenaming] = useState(false);
  const [label, setLabel] = useState(search.label);
  const [status, setStatus] = useState<ActionStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");

  useEffect(() => {
    setLabel(search.label);
  }, [search.label]);

  useEffect(() => {
    if (copyStatus === "idle") return;
    const timeout = window.setTimeout(() => setCopyStatus("idle"), COPY_RESET_MS);
    return () => window.clearTimeout(timeout);
  }, [copyStatus]);

  const lastActivityLabel = useMemo(
    () => formatRelativeTimeFromTimestamp(toTimestamp(search.lastActivityAt)),
    [search.lastActivityAt],
  );

  const isSaving = status === "saving";
  const trimmedLabel = label.trim();
  const labelIsValid = trimmedLabel.length > 0;
  const openHref = `/customer/search?quote=${encodeURIComponent(search.quoteId)}`;
  const lastViewedLabel = formatDateTime(search.lastViewedAt, {
    includeTime: true,
    fallback: "Not viewed yet",
  });
  const processLabel = search.summary.process ?? "Pending";
  const quantityLabel = search.summary.quantity ?? "Pending";
  const needByLabel = formatDateTime(search.summary.needBy, { fallback: "Pending" });
  const locationsLabel = formatLocationsSummary(search.summary.locations);
  const copyLabel =
    copyStatus === "copied" ? "Copied" : copyStatus === "error" ? "Copy failed" : "Copy link";

  const handleRename = async () => {
    if (!labelIsValid) {
      setErrorMessage("Add a label before saving.");
      return;
    }
    setStatus("saving");
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/portal/customer/saved-searches/${encodeURIComponent(search.quoteId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: trimmedLabel }),
        },
      );
      const payload = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!payload || payload.ok !== true) {
        setStatus("error");
        if (payload?.error === "unsupported") {
          setErrorMessage("Saved searches are not available on this deployment yet.");
        } else {
          setErrorMessage("Could not rename this search. Try again.");
        }
        return;
      }
      setStatus("idle");
      setIsRenaming(false);
      router.refresh();
    } catch {
      setStatus("error");
      setErrorMessage("Could not rename this search. Try again.");
    }
  };

  const handleCopyLink = async () => {
    const shareUrl = buildShareUrl(openHref);
    const copied = await copyToClipboard(shareUrl);
    setCopyStatus(copied ? "copied" : "error");
  };

  const handleDelete = async () => {
    if (!window.confirm("Delete this saved search?")) return;
    setStatus("saving");
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/portal/customer/saved-searches/${encodeURIComponent(search.quoteId)}`,
        { method: "DELETE" },
      );
      const payload = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!payload || payload.ok !== true) {
        setStatus("error");
        if (payload?.error === "unsupported") {
          setErrorMessage("Saved searches are not available on this deployment yet.");
        } else {
          setErrorMessage("Could not delete this search. Try again.");
        }
        return;
      }
      setStatus("idle");
      router.refresh();
    } catch {
      setStatus("error");
      setErrorMessage("Could not delete this search. Try again.");
    }
  };

  return (
    <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-4 py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <p className="text-base font-semibold text-white">{search.label}</p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>Last viewed {lastViewedLabel}</span>
            <span>•</span>
            <span>Saved {formatDateTime(search.createdAt)}</span>
            <span>•</span>
            <span>{lastActivityLabel ? `Activity ${lastActivityLabel}` : "Activity pending"}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <SummaryChip label="Process" value={processLabel} />
            <SummaryChip label="Qty" value={quantityLabel} />
            <SummaryChip label="Need-by" value={needByLabel} />
            {locationsLabel ? <SummaryChip label="Locations" value={locationsLabel} /> : null}
          </div>
        </div>
        <div className="flex flex-col items-start gap-2">
          {isRenaming ? (
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="text"
                value={label}
                maxLength={MAX_LABEL_LENGTH}
                onChange={(event) => {
                  setLabel(event.target.value);
                  setErrorMessage(null);
                  setStatus("idle");
                }}
                disabled={isSaving}
                className={clsx(INPUT_CLASSES, "sm:min-w-[220px]")}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleRename}
                  disabled={!labelIsValid || isSaving}
                  className={clsx(
                    ACTION_BUTTON_CLASSES,
                    (!labelIsValid || isSaving) && ACTION_BUTTON_DISABLED_CLASSES,
                  )}
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsRenaming(false);
                    setLabel(search.label);
                    setErrorMessage(null);
                    setStatus("idle");
                  }}
                  disabled={isSaving}
                  className={clsx(
                    ACTION_BUTTON_CLASSES,
                    isSaving && ACTION_BUTTON_DISABLED_CLASSES,
                  )}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Link href={openHref} className={ACTION_BUTTON_CLASSES}>
                Open
              </Link>
              <button
                type="button"
                onClick={handleCopyLink}
                disabled={isSaving}
                className={clsx(
                  ACTION_BUTTON_CLASSES,
                  isSaving && ACTION_BUTTON_DISABLED_CLASSES,
                )}
              >
                {copyLabel}
              </button>
              <button
                type="button"
                onClick={() => setIsRenaming(true)}
                disabled={isSaving}
                className={clsx(
                  ACTION_BUTTON_CLASSES,
                  isSaving && ACTION_BUTTON_DISABLED_CLASSES,
                )}
              >
                Rename
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isSaving}
                className={clsx(
                  ACTION_BUTTON_CLASSES,
                  ACTION_DANGER_CLASSES,
                  isSaving && ACTION_BUTTON_DISABLED_CLASSES,
                )}
              >
                Delete
              </button>
            </div>
          )}
          {errorMessage ? (
            <p className="text-xs text-red-200">{errorMessage}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SummaryChip({ label, value }: { label: string; value: string }) {
  return (
    <span className={SUMMARY_CHIP_CLASSES}>
      <span>{label}</span>
      <span className={SUMMARY_VALUE_CLASSES}>{value}</span>
    </span>
  );
}

function formatLocationsSummary(locations: string[]): string | null {
  if (!Array.isArray(locations) || locations.length === 0) return null;
  if (locations.length <= 2) return locations.join(", ");
  return `${locations.slice(0, 2).join(", ")} + ${locations.length - 2}`;
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
