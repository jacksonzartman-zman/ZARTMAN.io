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
      className={[
        "bg-transparent px-0 py-0 text-xs font-semibold underline-offset-4 transition",
        copied ? "text-emerald-200" : "text-slate-300 hover:text-white hover:underline",
      ].join(" ")}
    >
      {copied ? "Copied" : "Copy invite link"}
    </button>
  );
}

