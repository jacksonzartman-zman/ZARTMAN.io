"use client";

import clsx from "clsx";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type ShareStatus = "idle" | "copied" | "error";

type DecisionCta = {
  label: string;
  href?: string;
  disabled?: boolean;
  kind?: "share";
};

type CustomerQuoteDecisionCtaRowProps = {
  statusLabel: string;
  helperCopy?: string | null;
  primary: DecisionCta;
  secondary?: DecisionCta | null;
  sharePath?: string;
};

const SHARE_RESET_MS = 2200;
const PRIMARY_ACTIVE_CLASSES =
  "inline-flex items-center justify-center rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-black transition hover:bg-emerald-400";
const PRIMARY_DISABLED_CLASSES =
  "cursor-not-allowed bg-slate-800 text-slate-300 hover:bg-slate-800";
const SECONDARY_ACTIVE_CLASSES =
  "inline-flex items-center justify-center rounded-full border border-slate-800 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-600 hover:text-white";
const SECONDARY_DISABLED_CLASSES =
  "cursor-not-allowed border-slate-800 text-slate-500 hover:border-slate-800 hover:text-slate-500";

export function CustomerQuoteDecisionCtaRow({
  statusLabel,
  helperCopy,
  primary,
  secondary,
  sharePath,
}: CustomerQuoteDecisionCtaRowProps) {
  const [shareStatus, setShareStatus] = useState<ShareStatus>("idle");

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

  const primaryDisabled = Boolean(primary.disabled) || !primary.href;
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

  return (
    <section
      className="rounded-2xl border border-slate-900/60 bg-slate-950/40 px-5 py-4"
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
        <div className="flex flex-wrap items-center gap-2">
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
          {primaryDisabled ? (
            <button type="button" disabled className={primaryClasses}>
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
