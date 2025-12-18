export type ThreadRole = "customer" | "supplier" | "admin";

export type ThreadNeedsReply = "customer" | "supplier" | "admin" | "none" | "unknown";

export type ThreadStatusLabel =
  | "Needs your reply"
  | "Waiting on customer"
  | "Waiting on supplier"
  | "Waiting on admin"
  | "Up to date"
  | "Status unknown";

export function resolveThreadStatusLabel(
  viewerRole: ThreadRole,
  needsReplyFrom: ThreadNeedsReply,
): ThreadStatusLabel {
  if (needsReplyFrom === "unknown") return "Status unknown";
  if (needsReplyFrom === "none") return "Up to date";

  if (needsReplyFrom === "customer") {
    return viewerRole === "customer" ? "Needs your reply" : "Waiting on customer";
  }

  if (needsReplyFrom === "supplier") {
    return viewerRole === "supplier" ? "Needs your reply" : "Waiting on supplier";
  }

  if (needsReplyFrom === "admin") {
    return viewerRole === "admin" ? "Needs your reply" : "Waiting on admin";
  }

  return "Status unknown";
}

