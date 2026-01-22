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
const SECONDARY_ACTIVE_CLASSES =
  "inline-flex min-h-11 items-center justify-center text-sm font-semibold text-slate-300 transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500";
const SECONDARY_DISABLED_CLASSES =
  "cursor-not-allowed text-slate-500 hover:text-slate-500";

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
  const secondaryClasses = clsx(
    SECONDARY_ACTIVE_CLASSES,
    secondaryDisabled && SECONDARY_DISABLED_CLASSES,
  );

  const inviteDisabled = !quoteId || !sharePath;
  const inviteClasses = clsx(
    SECONDARY_ACTIVE_CLASSES,
    inviteDisabled && SECONDARY_DISABLED_CLASSES,
  );

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
            {secondary ? (
              secondary.kind === "share" ? (
                <button
                  type="button"
                  onClick={handleShare}
                  disabled={secondaryDisabled}
                  className={secondaryClasses}
                >
                  {shareLabel}
                </button>
              ) : secondaryDisabled ? (
                <button type="button" disabled className={secondaryClasses}>
                  {secondary.label}
                </button>
              ) : (
                <Link href={secondary.href ?? "#"} className={secondaryClasses}>
                  {secondary.label}
                </Link>
              )
            ) : null}

            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              disabled={inviteDisabled}
              className={inviteClasses}
            >
              Invite teammate
            </button>

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
