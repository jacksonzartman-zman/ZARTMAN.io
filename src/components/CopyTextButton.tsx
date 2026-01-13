"use client";

import { useState } from "react";

type CopyTextButtonProps = {
  text: string;
  idleLabel: string;
  copiedLabel?: string;
  className?: string;
  logPrefix?: string;
};

export function CopyTextButton({
  text,
  idleLabel,
  copiedLabel = "Copied",
  className,
  logPrefix = "[copy]",
}: CopyTextButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.error(`${logPrefix} copy failed`, error);
      setCopied(false);
    }
  }

  const disabled = !text.trim();

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={disabled}
      className={
        className ??
        "rounded-full border border-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-slate-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
      }
    >
      {copied ? copiedLabel : idleLabel}
    </button>
  );
}

