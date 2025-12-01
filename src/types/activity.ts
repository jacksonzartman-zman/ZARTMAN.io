export type ActivityType = "quote" | "bid" | "status";

export type ActivityItem = {
  id: string;
  type: ActivityType;
  title: string;
  description: string;
  timestamp: string;
  href?: string;
};

export type QuoteActivityEventType =
  | "rfq_submitted"
  | "status_changed"
  | "message_posted"
  | "bid_received"
  | "winner_selected";

export type QuoteActivityEvent = {
  id: string;
  quoteId: string;
  type: QuoteActivityEventType;
  title: string;
  description: string;
  timestamp: string;
  href?: string;
  actor?: string | null;
  metadata?: Record<string, string | number | null | undefined>;
};
