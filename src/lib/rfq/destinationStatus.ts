export const DESTINATION_STATUS_VALUES = [
  "queued",
  "sent",
  "submitted",
  "viewed",
  "pending",
  "quoted",
  "declined",
  "error",
] as const;

export type DestinationStatus = (typeof DESTINATION_STATUS_VALUES)[number];

export type DestinationStatusMeta = {
  label: string;
  shortLabel?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
};

export const DESTINATION_STATUS_META = {
  queued: { label: "Queued", tone: "neutral" },
  sent: { label: "Sent", tone: "neutral" },
  submitted: { label: "Submitted", tone: "neutral" },
  viewed: { label: "Viewed", tone: "neutral" },
  pending: { label: "Pending", tone: "warning" },
  quoted: { label: "Quoted", tone: "success" },
  declined: { label: "Declined", tone: "warning" },
  error: { label: "Error", tone: "danger" },
} satisfies Record<DestinationStatus, DestinationStatusMeta>;

export type DestinationStatusCounts = Partial<Record<DestinationStatus, number>>;
