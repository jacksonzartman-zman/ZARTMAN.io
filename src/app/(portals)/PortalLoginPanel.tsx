"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { requestMagicLinkForEmail } from "@/app/auth/actions";
import { SHOW_LEGACY_QUOTE_ENTRYPOINTS } from "@/lib/ui/deprecation";
import type { PortalRole } from "@/types/portal";

type PortalLoginPanelProps = {
  role: PortalRole;
  fallbackRedirect: string;
  nextPath?: string | null;
};

const ROLE_COPY: Record<
  PortalRole,
  { title: string; description: string; accent: string; cta: string }
> = {
  customer: {
    title: "Customer workspace",
    description: "Use your work email and we’ll send you a magic link to your workspace.",
    accent: "text-emerald-300",
    cta: "Email me a link",
  },
  supplier: {
    title: "Supplier workspace",
    description: "Use the email you onboarded with and we’ll send you a magic link.",
    accent: "text-blue-300",
    cta: "Send magic link",
  },
};

const LEGACY_QUOTE_PATH = "/quote";
const CUSTOMER_SEARCH_PATH = "/customer/search";

function isLegacyQuotePath(nextPath: string) {
  return (
    nextPath === LEGACY_QUOTE_PATH ||
    nextPath.startsWith(`${LEGACY_QUOTE_PATH}/`) ||
    nextPath.startsWith(`${LEGACY_QUOTE_PATH}?`) ||
    nextPath.startsWith(`${LEGACY_QUOTE_PATH}#`)
  );
}

function resolveLegacyQuoteNextPath(nextPath: string | null, role: PortalRole) {
  if (!nextPath) {
    return null;
  }
  if (SHOW_LEGACY_QUOTE_ENTRYPOINTS) {
    return nextPath;
  }
  if (!isLegacyQuotePath(nextPath)) {
    return nextPath;
  }
  return role === "customer" ? CUSTOMER_SEARCH_PATH : null;
}

function isQuoteFlow(nextPath?: string | null) {
  if (!SHOW_LEGACY_QUOTE_ENTRYPOINTS || !nextPath) {
    return false;
  }
  return isLegacyQuotePath(nextPath);
}

export function PortalLoginPanel({ role, fallbackRedirect, nextPath }: PortalLoginPanelProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<{ supabaseMessage: string | null; status: number | null } | null>(
    null,
  );
  const [lastSentTo, setLastSentTo] = useState<string | null>(null);
  const [lastRequestId, setLastRequestId] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(false);
  const pathname = usePathname();
  const roleIsKnown = Object.prototype.hasOwnProperty.call(ROLE_COPY, role);
  if (!roleIsKnown) {
    console.warn("[portal-login] unknown role received, defaulting to customer", {
      role,
    });
  }
  const resolvedRole: PortalRole = roleIsKnown ? role : "customer";

  const normalizedNextPath =
    typeof nextPath === "string" && nextPath.startsWith("/") ? nextPath : null;
  const gatedNextPath = resolveLegacyQuoteNextPath(normalizedNextPath, resolvedRole);
  const redirectPath =
    gatedNextPath ??
    (typeof pathname === "string" && pathname.startsWith(`/${resolvedRole}`)
      ? pathname
      : fallbackRedirect);
  const quoteFlow = isQuoteFlow(normalizedNextPath);

  useEffect(() => {
    if (quoteFlow) {
      console.log("[login] rendering quote-flow login", { nextPath: normalizedNextPath });
    }
  }, [quoteFlow, normalizedNextPath]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      setError(
        resolvedRole === "supplier"
          ? "Enter a business email that matches your onboarding profile."
          : "Enter a valid work email.",
      );
      setDebug(null);
      setLastRequestId(null);
      setStatus("error");
      return;
    }

    try {
      setStatus("sending");
      setError(null);
      setDebug(null);
      const clientOrigin = window.location.origin;
      const result = await requestMagicLinkForEmail({
        role: resolvedRole,
        email: normalizedEmail,
        nextPath: redirectPath,
        clientOrigin,
      });
      setLastRequestId(result.requestId);
      if (!result.ok) {
        setStatus("error");
        setError(result.error);
        setDebug(result.debug ?? null);
        return;
      }
      setStatus("sent");
      setLastSentTo(normalizedEmail);
    } catch (err) {
      console.error("Portal login: failed to request magic link", err);
      setError(
        resolvedRole === "supplier"
          ? "We couldn’t send the link. Check your connection and try again."
          : "We couldn’t send the link. Try again in a few seconds.",
      );
      setDebug(null);
      setLastRequestId(null);
      setStatus("error");
    } finally {
      setCooldown(true);
      window.setTimeout(() => setCooldown(false), 2500);
    }
  }

  const baseCopy = ROLE_COPY[resolvedRole];
  const copy = quoteFlow
    ? {
        ...baseCopy,
        title: "Log in to start a search",
        description:
          "Use your work email and we'll send you a magic link to your customer workspace.",
        cta: "Send magic link",
      }
    : baseCopy;

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
          disabled={status === "sending" || cooldown}
          className="w-full rounded-full border border-slate-800 bg-white/90 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-white disabled:opacity-60"
        >
          {status === "sending" ? "Sending..." : copy.cta}
        </button>
        {status === "sent" ? (
            <div className="space-y-1">
              <p className="text-sm text-emerald-200">
                Magic link sent. Request ID:{" "}
                <span className="font-mono text-white">{lastRequestId ?? "unknown"}</span>
              </p>
              <p className="text-xs text-slate-400">
                Sent to{" "}
                <span className="font-mono text-slate-200">
                  {lastSentTo ?? email.trim().toLowerCase()}
                </span>
                . Check your inbox (and spam).
              </p>
            </div>
          ) : null}
        {error ? (
          <div role="alert" className="space-y-1">
            <p className="text-sm text-red-300">{error}</p>
            {lastRequestId ? (
              <p className="text-xs text-slate-400">
                Request ID: <span className="font-mono text-slate-200">{lastRequestId}</span>
              </p>
            ) : null}
            {debug ? (
              <p className="text-xs text-slate-400">
                Debug (non-prod): status{" "}
                <span className="font-mono text-slate-200">{String(debug.status)}</span>, message{" "}
                <span className="font-mono text-slate-200">{debug.supabaseMessage ?? "null"}</span>
              </p>
            ) : null}
          </div>
        ) : null}
        <p className="text-xs text-slate-500">
          You’ll land back on <span className="font-mono text-slate-300">{redirectPath}</span> after
          clicking the link.
        </p>
      </form>
    </section>
  );
}
