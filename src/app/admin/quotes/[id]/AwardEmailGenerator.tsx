"use client";

import clsx from "clsx";
import { useState, useTransition } from "react";
import { CopyTextButton } from "@/components/CopyTextButton";
import { ctaSizeClasses, secondaryCtaClasses } from "@/lib/ctas";
import { formatDateTime } from "@/lib/formatDate";
import { generateAwardEmailAction } from "./actions";

type AwardEmailGeneratorProps = {
  quoteId: string;
  selectedOfferId: string | null;
  selectionConfirmedAt?: string | null;
};

type EmailPackage = {
  subject: string;
  body: string;
};

export function AwardEmailGenerator({
  quoteId,
  selectedOfferId,
  selectionConfirmedAt,
}: AwardEmailGeneratorProps) {
  const [pending, startTransition] = useTransition();
  const [emailPackage, setEmailPackage] = useState<EmailPackage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canGenerate = Boolean(selectedOfferId);
  const confirmedLabel = selectionConfirmedAt
    ? formatDateTime(selectionConfirmedAt, { includeTime: true }) ?? selectionConfirmedAt
    : null;

  const handleGenerate = () => {
    if (!canGenerate || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await generateAwardEmailAction({ quoteId });
      if (result.ok) {
        setEmailPackage({ subject: result.subject, body: result.body });
      } else {
        setEmailPackage(null);
        setError(result.error);
      }
    });
  };

  return (
    <>
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-5 py-4 text-sm text-slate-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Award pack
            </p>
            <p className="mt-1 text-sm text-slate-300">
              Generate the provider-facing award email template.
            </p>
            {confirmedLabel ? (
              <p className="mt-2 text-xs text-emerald-200">
                Selection confirmed {confirmedLabel}.
              </p>
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                Selection confirmation not recorded yet.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate || pending}
            className={clsx(
              secondaryCtaClasses,
              ctaSizeClasses.sm,
              !canGenerate || pending ? "cursor-not-allowed opacity-60" : null,
            )}
          >
            {pending ? "Generating..." : "Generate Award Email"}
          </button>
        </div>
        {error ? (
          <p className="mt-2 text-xs text-amber-200" role="alert">
            {error}
          </p>
        ) : null}
        {!canGenerate ? (
          <p className="mt-2 text-xs text-slate-500">
            Select an offer to enable the award email.
          </p>
        ) : null}
      </section>

      <AwardEmailModal
        isOpen={Boolean(emailPackage)}
        subject={emailPackage?.subject ?? ""}
        body={emailPackage?.body ?? ""}
        onClose={() => setEmailPackage(null)}
      />
    </>
  );
}

function AwardEmailModal({
  isOpen,
  subject,
  body,
  onClose,
}: {
  isOpen: boolean;
  subject: string;
  body: string;
  onClose: () => void;
}) {
  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Award email"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Award email</h3>
            <p className="mt-1 text-sm text-slate-300">
              Copy and paste this template to email the provider.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Subject
            </label>
            <input
              value={subject}
              readOnly
              className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 focus:outline-none"
            />
            <CopyTextButton text={subject} idleLabel="Copy subject" />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Body
            </label>
            <textarea
              value={body}
              readOnly
              rows={12}
              className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 focus:outline-none"
            />
            <CopyTextButton text={body} idleLabel="Copy body" />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-800 bg-slate-950/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 hover:border-slate-600 hover:text-white"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
