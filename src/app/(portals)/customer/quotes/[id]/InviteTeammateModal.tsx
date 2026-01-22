"use client";

import clsx from "clsx";
import { useEffect, useMemo, useState, useTransition } from "react";

type ModalMode = "form" | "success";

type InviteTeammateModalProps = {
  open: boolean;
  onClose: () => void;
  quoteId: string;
  sharePath: string;
};

type ApiResponse =
  | { ok: true; sent: number; provider: string; shareUrl?: string }
  | { ok: false; error: string; shareUrl?: string };

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (!normalized.includes("@")) return null;
  if (/\s/.test(normalized)) return null;
  if (normalized.length > 320) return null;
  return normalized;
}

function parseEmails(input: string): string[] {
  return input
    .split(/[,\n;]+/g)
    .map((v) => v.trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const v = value.trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
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

export function InviteTeammateModal({
  open,
  onClose,
  quoteId,
  sharePath,
}: InviteTeammateModalProps) {
  const [mode, setMode] = useState<ModalMode>("form");
  const [pending, startTransition] = useTransition();
  const [emailsRaw, setEmailsRaw] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successLine, setSuccessLine] = useState<string | null>(null);

  const shareUrl = useMemo(() => buildShareUrl(sharePath), [sharePath]);

  const parsedEmails = useMemo(() => {
    const parsed = parseEmails(emailsRaw);
    const normalized = uniqueStrings(parsed)
      .map((e) => normalizeEmail(e))
      .filter((e): e is string => Boolean(e))
      .slice(0, 10);
    return normalized;
  }, [emailsRaw]);

  useEffect(() => {
    if (!open) return;
    setMode("form");
    setEmailsRaw("");
    setMessage("");
    setError(null);
    setSuccessLine(null);
  }, [open]);

  if (!open) return null;

  const canSubmit = !pending && Boolean(quoteId) && Boolean(sharePath) && parsedEmails.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      let result: ApiResponse | null = null;
      try {
        const res = await fetch("/api/portal/customer/invite-teammate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            quoteId,
            emails: parsedEmails,
            message: message.trim() || undefined,
          }),
        });
        result = (await res.json().catch(() => null)) as ApiResponse | null;
      } catch (e) {
        result = { ok: false, error: "network_error" };
      }

      const serverShareUrl = result && "shareUrl" in result ? normalizeString(result.shareUrl) : "";
      const linkToCopy = serverShareUrl || shareUrl;

      if (result?.ok) {
        setMode("success");
        setSuccessLine(`Invite sent to ${Math.max(1, result.sent)} teammate${result.sent === 1 ? "" : "s"}.`);
        return;
      }

      // Fail-soft path: copy link so user can send manually.
      const copied = await copyToClipboard(linkToCopy);
      setMode("success");
      setSuccessLine(copied ? "Copied link—send manually." : "Copy link failed—send manually.");
    });
  };

  const closeLabel = mode === "success" ? "Done" : "Close";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-label="Invite teammate"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950/95 p-6 text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
              Invite teammate
            </p>
            <h3 className="mt-1 text-lg font-semibold text-white">
              {mode === "success" ? "All set" : "Share this search request"}
            </h3>
            {mode === "success" ? (
              <p className="mt-1 text-sm text-slate-300">{successLine ?? "Done."}</p>
            ) : (
              <p className="mt-1 text-sm text-slate-300">
                We’ll email them a link to review this search request.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:text-white"
          >
            {closeLabel}
          </button>
        </div>

        {mode === "success" ? (
          <div className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {successLine ?? "Done."}
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <label className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Email(s)
              </span>
              <textarea
                value={emailsRaw}
                onChange={(e) => setEmailsRaw(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                placeholder={"teammate@company.com\nteammate2@company.com"}
              />
              <span className="text-xs text-slate-500">
                Add up to 10 emails (comma or newline separated).
              </span>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Message (optional)
              </span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                maxLength={5000}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                placeholder="Any context you want them to know?"
              />
            </label>

            {error ? (
              <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-4 py-3 text-sm text-yellow-100">
                {error}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <button
                type="button"
                onClick={async () => {
                  const copied = await copyToClipboard(shareUrl);
                  setError(null);
                  setSuccessLine(copied ? "Copied link—send manually." : "Copy link failed—send manually.");
                  setMode("success");
                }}
                disabled={pending}
                className={clsx(
                  "rounded-full border border-slate-800 bg-slate-950/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 hover:border-slate-600 hover:text-white",
                  pending ? "cursor-not-allowed opacity-60" : "",
                )}
              >
                Copy link
              </button>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={pending}
                  className={clsx(
                    "rounded-full border border-slate-800 bg-slate-950/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 hover:border-slate-600 hover:text-white",
                    pending ? "cursor-not-allowed opacity-60" : "",
                  )}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSubmit}
                  className={clsx(
                    "rounded-full border border-emerald-400/50 bg-emerald-500 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-950 transition hover:bg-emerald-400",
                    !canSubmit ? "cursor-not-allowed opacity-60" : "",
                  )}
                >
                  {pending ? "Sending..." : "Send invite"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

