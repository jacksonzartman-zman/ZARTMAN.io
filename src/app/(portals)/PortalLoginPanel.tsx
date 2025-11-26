"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { requestMagicLinkForEmail } from "@/app/auth/actions";
import type { PortalRole } from "@/types/portal";

type PortalLoginPanelProps = {
  role: PortalRole;
  fallbackRedirect: string;
};

const ROLE_COPY: Record<
  PortalRole,
  { title: string; description: string; accent: string; cta: string }
> = {
  customer: {
    title: "Sign in to the customer portal",
    description: "Use the email you shared with the Zartman team to receive your magic link.",
    accent: "text-emerald-300",
    cta: "Email me a link",
  },
  supplier: {
    title: "Sign in to your supplier workspace",
    description:
      "We’ll email a one-time magic link to the address tied to your onboarding profile. Use that same inbox to access RFQs.",
    accent: "text-blue-300",
    cta: "Send magic link",
  },
};

export function PortalLoginPanel({ role, fallbackRedirect }: PortalLoginPanelProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastSentTo, setLastSentTo] = useState<string | null>(null);
  const pathname = usePathname();
  const roleIsKnown = Object.prototype.hasOwnProperty.call(ROLE_COPY, role);
  if (!roleIsKnown) {
    console.warn("[portal-login] unknown role received, defaulting to customer", {
      role,
    });
  }
  const resolvedRole: PortalRole = roleIsKnown ? role : "customer";

  const redirectPath =
    typeof pathname === "string" && pathname.startsWith(`/${resolvedRole}`)
      ? pathname
      : fallbackRedirect;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      setError(
        resolvedRole === "supplier"
          ? "Enter a business email that matches your onboarding profile."
          : "Enter a valid work email.",
      );
      setStatus("error");
      return;
    }

    try {
      setStatus("sending");
      setError(null);
      const result = await requestMagicLinkForEmail({
        role: resolvedRole,
        email: normalizedEmail,
        nextPath: redirectPath,
      });
      if (!result.success) {
        setStatus("error");
        setError(
          result.error ??
            (resolvedRole === "supplier"
              ? "We couldn’t send the link. Check your connection and try again."
              : "We couldn’t send the link. Try again in a few seconds."),
        );
        return;
      }
      setStatus("sent");
      setLastSentTo(result.normalizedEmail ?? normalizedEmail);
    } catch (err) {
      console.error("Portal login: failed to request magic link", err);
      setError(
        resolvedRole === "supplier"
          ? "We couldn’t send the link. Check your connection and try again."
          : "We couldn’t send the link. Try again in a few seconds.",
      );
      setStatus("error");
    }
  }

  const copy = ROLE_COPY[resolvedRole];

  return (
    <section className="mx-auto max-w-lg rounded-2xl border border-slate-900 bg-slate-950/50 p-6">
      <p className={`text-xs font-semibold uppercase tracking-[0.3em] ${copy.accent}`}>
        {resolvedRole} portal
      </p>
      <h2 className="mt-2 text-xl font-semibold text-white">{copy.title}</h2>
      <p className="mt-1 text-sm text-slate-400">{copy.description}</p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-3">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Work email
        </label>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-white focus:outline-none"
          placeholder="you@company.com"
          required
        />
          <button
          type="submit"
          disabled={status === "sending"}
          className="w-full rounded-full border border-slate-800 bg-white/90 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-white disabled:opacity-60"
        >
          {status === "sending" ? "Sending..." : copy.cta}
        </button>
        {status === "sent" ? (
            <p className="text-sm text-emerald-200">
              {resolvedRole === "supplier" ? (
                <>
                  Link sent to{" "}
                  <span className="font-mono text-white">
                    {lastSentTo ?? email.trim().toLowerCase()}
                  </span>{" "}
                  – check your inbox.
                </>
              ) : (
                "Check your inbox for the magic link."
              )}
            </p>
          ) : null}
        {error ? (
          <p className="text-sm text-red-300" role="alert">
            {error}
          </p>
        ) : null}
        <p className="text-xs text-slate-500">
          You’ll land back on <span className="font-mono text-slate-300">{redirectPath}</span> after
          clicking the link.
        </p>
      </form>
    </section>
  );
}
