import { normalizeQuoteStatus, type QuoteStatus } from "@/server/quotes/status";

export type QuoteActorRole = "customer" | "supplier" | "admin";

export type PrimaryActionTone = "emerald" | "blue" | "slate";

export type PrimaryAction = {
  label: string;
  href: string;
  tone: PrimaryActionTone;
};

type PrimaryActionHints = {
  /**
   * Pre-derived, role-specific signals. The caller should compute these using
   * existing helpers already used on the page (e.g. canUserBid, attention state,
   * kickoff progress basis, etc).
   */
  canAward?: boolean;
  hasWinner?: boolean;
  needsDecision?: boolean;
  kickoffComplete?: boolean;
  canSubmitBid?: boolean;
  awardedToSupplier?: boolean;
};

export type PrimaryActionQuote = {
  id: string;
  status?: string | null;
  awarded_supplier_id?: string | null;
  awarded_bid_id?: string | null;
  awarded_at?: string | null;
  kickoff_completed_at?: string | null;
  primaryActionHints?: PrimaryActionHints;
};

export function resolvePrimaryAction({
  role,
  quote,
}: {
  role: QuoteActorRole;
  quote: PrimaryActionQuote;
}): PrimaryAction {
  const hints = quote.primaryActionHints ?? {};
  const status: QuoteStatus = normalizeQuoteStatus(quote.status ?? null);
  const hasWinner =
    typeof hints.hasWinner === "boolean"
      ? hints.hasWinner
      : Boolean((quote.awarded_supplier_id ?? "").trim() || quote.awarded_at);

  if (role === "admin") {
    if (hints.needsDecision) {
      return { label: "Award", href: "#bids-panel", tone: "emerald" };
    }
    if (hasWinner) {
      return { label: "View kickoff", href: "#kickoff", tone: "emerald" };
    }
    return { label: "Open messages", href: "#messages-panel", tone: "emerald" };
  }

  if (role === "supplier") {
    if (hints.canSubmitBid) {
      return { label: "Submit bid", href: "#bid", tone: "blue" };
    }
    if (hints.awardedToSupplier) {
      return { label: "Kickoff", href: "#kickoff", tone: "emerald" };
    }
    if (hasWinner || status === "lost" || status === "cancelled") {
      return { label: "Open messages", href: "#messages", tone: "slate" };
    }
    return { label: "Open messages", href: "#messages", tone: "blue" };
  }

  // customer
  if (hints.canAward) {
    return { label: "Review bids", href: "#award", tone: "emerald" };
  }
  if (hasWinner && !hints.kickoffComplete) {
    return { label: "View kickoff", href: "#kickoff", tone: "emerald" };
  }
  if (status === "cancelled" || status === "lost") {
    return { label: "View timeline", href: "#timeline", tone: "slate" };
  }
  return { label: "View timeline", href: "#timeline", tone: "emerald" };
}

