"use client";

import { useState } from "react";

export function CopyInviteLinkButton({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.error("[customer invites] copy failed", error);
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded-full border border-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-slate-700 hover:text-white"
    >
      {copied ? "Copied" : "Copy invite link"}
    </button>
  );
}

