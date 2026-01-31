"use client";

import clsx from "clsx";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { InviteTeammateModal } from "./InviteTeammateModal";

type ShareStatus = "idle" | "copied" | "error";

type DecisionCta = {
  label: string;
  href?: string;
  disabled?: boolean;
  kind?: "share" | "button";
  onClick?: () => void;
};

type CustomerQuoteDecisionCtaRowProps = {
  quoteId?: string;
  statusLabel: string;
  helperCopy?: string | null;
  primary: DecisionCta;
  secondary?: DecisionCta | null;
  sharePath?: string;
};

const SHARE_RESET_MS = 2200;
const PRIMARY_ACTIVE_CLASSES =
  "inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-black shadow-sm transition hover:bg-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400";
const PRIMARY_DISABLED_CLASSES =
  "cursor-not-allowed bg-slate-800 text-slate-400 shadow-none hover:bg-slate-800";
const SECONDARY_MENU_SUMMARY_CLASSES =
  "inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-900/60 bg-slate-950/30 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:bg-slate-950/40 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 motion-reduce:transition-none";
const SECONDARY_MENU_ITEM_CLASSES =
  "flex w-full items-center rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-200 transition hover:bg-slate-900/60 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 motion-reduce:transition-none";
const SECONDARY_MENU_ITEM_DISABLED_CLASSES =
  "cursor-not-allowed text-slate-500 hover:bg-transparent hover:text-slate-500";

export function CustomerQuoteDecisionCtaRow({
  quoteId,
  statusLabel,
  helperCopy,
  primary,
  secondary,
  sharePath,
}: CustomerQuoteDecisionCtaRowProps) {
  const [shareStatus, setShareStatus] = useState<ShareStatus>("idle");
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(() => {
    if (shareStatus === "idle") return;
    const timeout = window.setTimeout(() => setShareStatus("idle"), SHARE_RESET_MS);
    return () => window.clearTimeout(timeout);
  }, [shareStatus]);

  const shareLabel = useMemo(() => {
    if (!secondary || secondary.kind !== "share") {
      return secondary?.label ?? "";
    }
    if (shareStatus === "copied") return "Copied";
    if (shareStatus === "error") return "Copy failed";
    return secondary.label;
  }, [secondary, shareStatus]);

  const handleShare = useCallback(async () => {
    if (!sharePath) {
      setShareStatus("error");
      return;
    }
    const copied = await copyToClipboard(buildShareUrl(sharePath));
    setShareStatus(copied ? "copied" : "error");
  }, [sharePath]);

  const primaryIsButton = primary.kind === "button";
  const primaryDisabled = Boolean(primary.disabled) || (primaryIsButton ? !primary.onClick : !primary.href);
  const primaryClasses = clsx(
    PRIMARY_ACTIVE_CLASSES,
    primaryDisabled && PRIMARY_DISABLED_CLASSES,
  );

  const secondaryDisabled =
    !secondary ||
    secondary.kind === "share"
      ? !sharePath
      : Boolean(secondary.disabled) || !secondary.href;

  const inviteDisabled = !quoteId || !sharePath;

  return (
    <>
      <section
        className="rounded-2xl border border-slate-900/60 bg-slate-950/50 px-5 py-4"
        aria-label="Decision actions"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {statusLabel}
            </p>
            {helperCopy ? (
              <p className="mt-1 text-sm text-slate-300">{helperCopy}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-4">
            <details className="group relative">
              <summary className={clsx(SECONDARY_MENU_SUMMARY_CLASSES, "cursor-pointer list-none select-none")}>
                <span className="flex items-center gap-2">
                  <span>More</span>
                  <span
                    className="text-slate-400 transition group-open:text-slate-200 motion-reduce:transition-none"
                    aria-hidden
                  >
                    ▾
                  </span>
                </span>
              </summary>
              <div className="absolute right-0 z-30 mt-2 w-64 overflow-hidden rounded-xl border border-slate-900/70 bg-slate-950 shadow-xl">
                <div className="flex flex-col gap-1 p-2">
                  {secondary ? (
                    secondary.kind === "share" ? (
                      <button
                        type="button"
                        onClick={handleShare}
                        disabled={secondaryDisabled}
                        className={clsx(
                          SECONDARY_MENU_ITEM_CLASSES,
                          secondaryDisabled && SECONDARY_MENU_ITEM_DISABLED_CLASSES,
                        )}
                      >
                        {shareLabel}
                      </button>
                    ) : secondaryDisabled ? (
                      <button
                        type="button"
                        disabled
                        className={clsx(SECONDARY_MENU_ITEM_CLASSES, SECONDARY_MENU_ITEM_DISABLED_CLASSES)}
                      >
                        {secondary.label}
                      </button>
                    ) : (
                      <Link
                        href={secondary.href ?? "#"}
                        className={SECONDARY_MENU_ITEM_CLASSES}
                      >
                        {secondary.label}
                      </Link>
                    )
                  ) : null}

                  <button
                    type="button"
                    onClick={() => setInviteOpen(true)}
                    disabled={inviteDisabled}
                    className={clsx(
                      SECONDARY_MENU_ITEM_CLASSES,
                      inviteDisabled && SECONDARY_MENU_ITEM_DISABLED_CLASSES,
                    )}
                  >
                    Invite teammate
                  </button>
                </div>
              </div>
            </details>

            {primaryDisabled ? (
              <button type="button" disabled className={primaryClasses}>
                {primary.label}
              </button>
            ) : primaryIsButton ? (
              <button type="button" onClick={primary.onClick} className={primaryClasses}>
                {primary.label}
              </button>
            ) : (
              <Link href={primary.href ?? "#"} className={primaryClasses}>
                {primary.label}
              </Link>
            )}
          </div>
        </div>
      </section>

      {quoteId && sharePath ? (
        <InviteTeammateModal
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
          quoteId={quoteId}
          sharePath={sharePath}
        />
      ) : null}
    </>
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
