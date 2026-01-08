export type QuoteWorkspaceStatus = "draft" | "in_review" | "awarded";

export function deriveQuoteWorkspaceStatus(args: {
  hasWinner: boolean;
  bidCount: number;
}): QuoteWorkspaceStatus {
  if (args.hasWinner) return "awarded";
  if (args.bidCount > 0) return "in_review";
  return "draft";
}

export function formatQuoteWorkspaceStatusLabel(
  status: QuoteWorkspaceStatus,
): string {
  switch (status) {
    case "awarded":
      return "Awarded";
    case "in_review":
      return "In Review";
    case "draft":
      return "Draft";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

