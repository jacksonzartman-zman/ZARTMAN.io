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
  lastActivityAt: string | null;
};

type ActionStatus = "idle" | "saving" | "error";

const ACTION_BUTTON_CLASSES =
  "inline-flex items-center rounded-full border border-slate-800 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-600 hover:text-white";
const ACTION_BUTTON_DISABLED_CLASSES =
  "cursor-not-allowed border-slate-900 text-slate-600";
const ACTION_DANGER_CLASSES =
  "border-red-500/40 text-red-200 hover:border-red-400 hover:text-white";
const INPUT_CLASSES =
  "w-full rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-emerald-400";
const MAX_LABEL_LENGTH = 120;

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

  useEffect(() => {
    setLabel(search.label);
  }, [search.label]);

  const lastActivityLabel = useMemo(
    () => formatRelativeTimeFromTimestamp(toTimestamp(search.lastActivityAt)),
    [search.lastActivityAt],
  );

  const isSaving = status === "saving";
  const trimmedLabel = label.trim();
  const labelIsValid = trimmedLabel.length > 0;
  const openHref = `/customer/search?quote=${encodeURIComponent(search.quoteId)}`;

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
            <span>Saved {formatDateTime(search.createdAt)}</span>
            <span>•</span>
            <span>{lastActivityLabel ? `Active ${lastActivityLabel}` : "Activity pending"}</span>
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
                Open results
              </Link>
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
