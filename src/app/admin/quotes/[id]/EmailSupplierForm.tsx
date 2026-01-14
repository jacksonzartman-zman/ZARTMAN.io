"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";

import { ctaSizeClasses, primaryCtaClasses, secondaryCtaClasses } from "@/lib/ctas";
import type { OutboundFileOption } from "@/server/quotes/outboundFilePicker";

type Result =
  | { kind: "idle" }
  | { kind: "sending" }
  | {
      kind: "sent";
      threadStored: boolean;
      attachmentsSent: number;
      attachmentsRequested: number;
      attachmentsMode: "none" | "latest_inbound" | "explicit";
    }
  | { kind: "error"; message: string };

const MAX_ATTACHMENTS = 5;
const DEFAULT_FILE_DISPLAY_LIMIT = 25;

function formatBytes(bytes: number | null): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

function formatCreatedAt(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export function EmailSupplierForm(props: { quoteId: string; enabled: boolean; fileOptions: OutboundFileOption[] }) {
  const [draft, setDraft] = useState("");
  const [includeLatestAttachments, setIncludeLatestAttachments] = useState(false);
  const [chooseFiles, setChooseFiles] = useState(false);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [result, setResult] = useState<Result>({ kind: "idle" });

  const helpCopy = useMemo(() => {
    if (!props.enabled) {
      return "Email not configured. Add EMAIL_PROVIDER + EMAIL_FROM + EMAIL_REPLY_DOMAIN + EMAIL_BRIDGE_SECRET.";
    }
    return "Send an email to the awarded supplier. They can reply directly via email to respond.";
  }, [props.enabled]);

  const canSend = props.enabled && draft.trim().length > 0 && draft.trim().length <= 5000 && result.kind !== "sending";

  const selectedLimitReached = selectedFileIds.length >= MAX_ATTACHMENTS;
  const visibleFiles = (Array.isArray(props.fileOptions) ? props.fileOptions : []).slice(0, DEFAULT_FILE_DISPLAY_LIMIT);

  const statusCopy =
    result.kind === "sent"
      ? result.threadStored
        ? result.attachmentsSent > 0
          ? `Sent (${result.attachmentsSent} attachment${result.attachmentsSent === 1 ? "" : "s"} — ${
              result.attachmentsMode === "explicit" ? "explicit" : "latest inbound"
            }).`
          : result.attachmentsMode === "none"
            ? "Sent."
            : "Sent (no attachments available within limits)."
        : result.attachmentsSent > 0
          ? `Sent (${result.attachmentsSent} attachment${result.attachmentsSent === 1 ? "" : "s"} — ${
              result.attachmentsMode === "explicit" ? "explicit" : "latest inbound"
            }, thread storage unavailable).`
          : result.attachmentsMode === "none"
            ? "Sent (thread storage unavailable)."
            : "Sent (no attachments available within limits, thread storage unavailable)."
      : result.kind === "error"
        ? result.message
        : null;

  return (
    <div className="rounded-2xl border border-slate-900 bg-slate-950/40 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Email supplier
          </p>
          <p className="mt-1 text-xs text-slate-400">{helpCopy}</p>
        </div>
        <button
          type="button"
          onClick={() => setDraft("")}
          className={clsx(secondaryCtaClasses, ctaSizeClasses.sm, "inline-flex")}
          disabled={result.kind === "sending" || draft.trim().length === 0}
        >
          Clear
        </button>
      </div>

      <div className="mt-3 space-y-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write a quick update or question…"
          className={clsx(
            "min-h-[96px] w-full resize-y rounded-xl border bg-slate-950/30 px-3 py-2 text-sm text-slate-100 outline-none",
            props.enabled ? "border-slate-900/60 focus:border-slate-700" : "border-slate-900/60 opacity-70",
          )}
          disabled={!props.enabled || result.kind === "sending"}
          maxLength={5000}
        />

        <label className={clsx("flex items-center gap-2 text-xs text-slate-400", !props.enabled && "opacity-70")}>
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={includeLatestAttachments}
            disabled={!props.enabled || result.kind === "sending"}
            onChange={(e) => {
              const checked = e.target.checked;
              setIncludeLatestAttachments(checked);
              if (checked) {
                setChooseFiles(false);
                setSelectedFileIds([]);
              }
            }}
          />
          Include latest email attachments (up to 5)
        </label>

        <label className={clsx("flex items-center gap-2 text-xs text-slate-400", !props.enabled && "opacity-70")}>
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={chooseFiles}
            disabled={!props.enabled || result.kind === "sending"}
            onChange={(e) => {
              const checked = e.target.checked;
              setChooseFiles(checked);
              if (checked) {
                setIncludeLatestAttachments(false);
              } else {
                setSelectedFileIds([]);
              }
            }}
          />
          Choose files…
        </label>

        {chooseFiles ? (
          <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2">
            <p className="text-xs text-slate-400">
              Select up to {MAX_ATTACHMENTS} files.
            </p>
            {visibleFiles.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">No files available for this quote.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {visibleFiles.map((f) => {
                  const checked = selectedFileIds.includes(f.id);
                  const disableCheckbox =
                    (!checked && selectedLimitReached) || !props.enabled || result.kind === "sending";
                  return (
                    <label key={f.id} className={clsx("flex items-start gap-2 text-xs", disableCheckbox && "opacity-70")}>
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4"
                        checked={checked}
                        disabled={disableCheckbox}
                        onChange={(e) => {
                          const nextChecked = e.target.checked;
                          setSelectedFileIds((prev) => {
                            const current = Array.isArray(prev) ? prev : [];
                            if (!nextChecked) {
                              return current.filter((id) => id !== f.id);
                            }
                            if (current.includes(f.id)) return current;
                            if (current.length >= MAX_ATTACHMENTS) return current;
                            return [...current, f.id];
                          });
                        }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-slate-100">{f.filename ?? "Untitled file"}</span>
                        <span className="mt-0.5 block text-[11px] text-slate-500">
                          {formatBytes(f.sizeBytes)} · {formatCreatedAt(f.createdAt)}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p
            className={clsx(
              "text-xs",
              statusCopy
                ? result.kind === "error"
                  ? "text-red-200"
                  : "text-emerald-200"
                : "text-slate-500",
            )}
          >
            {statusCopy ?? `${draft.trim().length}/5000`}
          </p>
          <button
            type="button"
            onClick={async () => {
              const message = draft.trim();
              if (!message || message.length > 5000) return;
              setResult({ kind: "sending" });
              try {
                const body: Record<string, unknown> = { message };
                if (chooseFiles) {
                  if (selectedFileIds.length > 0) {
                    body.attachmentFileIds = selectedFileIds;
                  }
                } else if (includeLatestAttachments) {
                  body.attachmentFileIds = [];
                }
                const res = await fetch(`/api/admin/quotes/${props.quoteId}/email-supplier`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(body),
                });
                const payload = (await res.json().catch(() => null)) as any;
                if (!payload || payload.ok !== true) {
                  const error = typeof payload?.error === "string" ? payload.error : "unknown";
                  const message =
                    error === "disabled"
                      ? "Email not configured."
                      : error === "missing_recipient"
                        ? "Supplier email not available."
                        : error === "unsupported"
                          ? "Email delivery not supported on this environment."
                          : "Could not send email. Try again.";
                  setResult({ kind: "error", message });
                  return;
                }
                setDraft("");
                setIncludeLatestAttachments(false);
                setChooseFiles(false);
                setSelectedFileIds([]);
                setResult({
                  kind: "sent",
                  threadStored: Boolean(payload?.threadStored),
                  attachmentsSent: typeof payload?.attachmentsSent === "number" ? payload.attachmentsSent : 0,
                  attachmentsRequested:
                    typeof payload?.attachmentsRequested === "number" ? payload.attachmentsRequested : 0,
                  attachmentsMode:
                    payload?.attachmentsMode === "explicit" ||
                    payload?.attachmentsMode === "latest_inbound" ||
                    payload?.attachmentsMode === "none"
                      ? payload.attachmentsMode
                      : "none",
                });
              } catch {
                setResult({ kind: "error", message: "Could not send email. Try again." });
              }
            }}
            className={clsx(primaryCtaClasses, ctaSizeClasses.sm, "inline-flex")}
            disabled={!canSend}
          >
            {result.kind === "sending" ? "Sending…" : "Send email"}
          </button>
        </div>
      </div>
    </div>
  );
}

