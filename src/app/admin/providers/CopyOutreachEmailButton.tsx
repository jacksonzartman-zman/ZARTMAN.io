"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";

type CopyOutreachEmailButtonProps = {
  subject: string;
  body: string;
  className?: string;
};

type CopyStatus = "idle" | "copied" | "error";

export function CopyOutreachEmailButton({
  subject,
  body,
  className,
}: CopyOutreachEmailButtonProps) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const timeoutRef = useRef<number | null>(null);
  const template = buildTemplate(subject, body);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await copyToClipboard(template);
      setStatus("copied");
    } catch {
      setStatus("error");
    }

    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = window.setTimeout(() => setStatus("idle"), 2000);
  }, [template]);

  const label =
    status === "copied" ? "Copied" : status === "error" ? "Copy failed" : "Copy outreach";

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={clsx(
        "rounded-full border border-slate-700 px-3 py-1 font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white",
        className,
      )}
      aria-live="polite"
    >
      {label}
    </button>
  );
}

function buildTemplate(subject: string, body: string): string {
  const cleanedSubject = subject.trim();
  const cleanedBody = body.trim();
  if (!cleanedSubject && !cleanedBody) {
    return "";
  }
  if (!cleanedSubject) {
    return `Body:\n${cleanedBody}`;
  }
  if (!cleanedBody) {
    return `Subject: ${cleanedSubject}`;
  }
  return `Subject: ${cleanedSubject}\n\nBody:\n${cleanedBody}`;
}

async function copyToClipboard(text: string): Promise<void> {
  if (!text) return;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const success = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!success) {
    throw new Error("copy failed");
  }
}
