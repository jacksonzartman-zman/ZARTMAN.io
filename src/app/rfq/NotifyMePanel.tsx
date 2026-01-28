"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase.client";

type NotifyMePanelProps = {
  quoteId: string;
  intakeKey: string;
};

type ApiResponse =
  | { ok: false; error?: string }
  | { ok: true; status: "saved" | "cooldown"; id?: string | null };

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  if (!email || email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function NotifyMePanel({ quoteId, intakeKey }: NotifyMePanelProps) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabaseBrowser().auth.getUser();
        const next = normalizeEmail(data.user?.email ?? "");
        if (!alive) return;
        if (next && !email) setEmail(next);
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
    // We intentionally only want to prefill once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const normalizedEmail = useMemo(() => normalizeEmail(email), [email]);
  const canSubmit = Boolean(quoteId && intakeKey && isValidEmail(normalizedEmail) && !submitting);

  if (submitted) {
    return (
      <section className="rounded-3xl border border-slate-900/60 bg-slate-950/35 p-5">
        <p className="text-sm font-semibold text-ink">Notify me when offers arrive</p>
        <p className="mt-1 text-sm text-ink-muted" aria-live="polite">
          We’ll email you when offers arrive.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-slate-900/60 bg-slate-950/35 p-5">
      <p className="text-sm font-semibold text-ink">Notify me when offers arrive</p>
      <p className="mt-1 text-sm text-ink-muted">
        Optional. Enter an email and we’ll send you a message when your first offer shows up.
      </p>

      <form
        className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);

          const next = normalizedEmail;
          if (!isValidEmail(next)) {
            setError("Please enter a valid email.");
            return;
          }

          setSubmitting(true);
          try {
            const res = await fetch("/api/rfq/notify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ quoteId, intakeKey, email: next }),
            });
            const json = (await res.json()) as ApiResponse;
            if (!json || json.ok !== true) {
              setError(json && "error" in json && json.error ? json.error : "Something went wrong.");
              return;
            }
            setSubmitted(true);
          } catch {
            setError("Something went wrong.");
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <label className="flex-1">
          <span className="sr-only">Email</span>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-3 text-sm text-ink outline-none placeholder:text-ink-soft focus:border-slate-600"
          />
        </label>

        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/60 px-5 py-3 text-sm font-semibold text-ink transition hover:border-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Saving…" : "Notify me"}
        </button>
      </form>

      {error ? (
        <p className="mt-2 text-xs font-semibold text-rose-200" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

