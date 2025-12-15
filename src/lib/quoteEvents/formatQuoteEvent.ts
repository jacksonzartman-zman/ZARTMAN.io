import { formatShortId } from "@/lib/awards";
import type { QuoteEventActorRole, QuoteEventRecord } from "@/server/quotes/events";

export type QuoteEventGroupKey =
  | "rfq"
  | "bids"
  | "award"
  | "kickoff"
  | "messages"
  | "system"
  | "other";

export type FormattedQuoteEvent = {
  title: string;
  subtitle?: string;
  actorLabel?: string;
  groupKey: QuoteEventGroupKey;
  groupLabel: string;
};

/**
 * Central mapping from quote_events (event_type + metadata) -> human UI copy.
 * Keep this logic shared across all portals (admin/customer/supplier).
 */
export function formatQuoteEvent(event: QuoteEventRecord): FormattedQuoteEvent {
  const type = normalizeEventType(event.event_type);
  const metadata = resolveEventMetadata(event);
  const actorLabel = formatActorLabel(event.actor_role, metadata);

  if (type === "submitted") {
    return {
      groupKey: "rfq",
      groupLabel: "RFQ",
      title: "RFQ submitted",
      subtitle: "RFQ received and queued for review.",
      actorLabel,
    };
  }

  if (type === "supplier_invited") {
    const supplierLabel = formatSupplierIdentifier(metadata);
    return {
      groupKey: "rfq",
      groupLabel: "RFQ",
      title: "Supplier invited",
      subtitle: supplierLabel ?? undefined,
      actorLabel,
    };
  }

  if (type === "bid_received") {
    const supplierName = readString(metadata, "supplier_name");
    const isUpdate =
      readBoolean(metadata, "isUpdate") ?? readBoolean(metadata, "is_update");
    return {
      groupKey: "bids",
      groupLabel: "Bids",
      title: isUpdate ? "Bid updated" : "Bid received",
      subtitle: supplierName ? `From ${supplierName}.` : undefined,
      actorLabel,
    };
  }

  if (type === "awarded") {
    const supplierName = readString(metadata, "supplier_name");
    const bidId = readString(metadata, "bid_id");
    return {
      groupKey: "award",
      groupLabel: "Award",
      title: supplierName ? `Awarded to ${supplierName}` : "Awarded",
      subtitle: bidId ? `Winning bid: ${formatShortId(bidId)}` : undefined,
      actorLabel,
    };
  }

  if (type === "bid_won") {
    return {
      groupKey: "award",
      groupLabel: "Award",
      title: "Bid won",
      subtitle: formatSupplierIdentifier(metadata) ?? undefined,
      actorLabel,
    };
  }

  if (type === "quote_won") {
    return {
      groupKey: "award",
      groupLabel: "Award",
      title: "Quote won",
      subtitle: formatSupplierIdentifier(metadata) ?? undefined,
      actorLabel,
    };
  }

  if (type === "quote_reopened" || type === "reopened") {
    const subtitle =
      formatStatusTransitionSubtitle(metadata) ?? "Returned to reviewing bids.";
    return {
      groupKey: "rfq",
      groupLabel: "RFQ",
      title: "RFQ reopened",
      subtitle,
      actorLabel,
    };
  }

  if (type === "quote_archived" || type === "archived") {
    const subtitle =
      formatStatusTransitionSubtitle(metadata) ?? "Marked as cancelled.";
    return {
      groupKey: "rfq",
      groupLabel: "RFQ",
      title: "RFQ archived",
      subtitle,
      actorLabel,
    };
  }

  if (type === "kickoff_updated") {
    const summary = readString(metadata, "summary_label");
    const taskTitle = readString(metadata, "task_title");
    const completed = readBoolean(metadata, "completed");
    const taskSubtitle = taskTitle
      ? `${completed ? "Completed" : "Updated"}: ${taskTitle}.`
      : null;
    const combinedSubtitle = joinSubtitle(
      summary,
      taskSubtitle ? `· ${taskSubtitle}` : null,
    );

    return {
      groupKey: "kickoff",
      groupLabel: "Kickoff",
      title: "Kickoff updated",
      subtitle: combinedSubtitle ?? taskSubtitle ?? undefined,
      actorLabel,
    };
  }

  if (type === "kickoff_started") {
    const taskCount =
      readNumber(metadata, "taskCount") ??
      readNumber(metadata, "task_count") ??
      readNumber(metadata, "tasksCreated") ??
      readNumber(metadata, "tasks_created");
    const subtitle =
      typeof taskCount === "number" && Number.isFinite(taskCount) && taskCount > 0
        ? `${taskCount} tasks created.`
        : "Tasks created.";
    return {
      groupKey: "kickoff",
      groupLabel: "Kickoff",
      title: "Kickoff started",
      subtitle,
      actorLabel,
    };
  }

  if (type === "kickoff_completed") {
    return {
      groupKey: "kickoff",
      groupLabel: "Kickoff",
      title: "Kickoff completed",
      subtitle: "All kickoff tasks have been completed.",
      actorLabel,
    };
  }

  if (type === "message_posted") {
    const senderName = readString(metadata, "sender_name");
    return {
      groupKey: "messages",
      groupLabel: "Messages",
      title: "Message posted",
      subtitle: senderName ? `From ${senderName}.` : undefined,
      actorLabel,
    };
  }

  return {
    groupKey: inferFallbackGroup(event.actor_role),
    groupLabel: formatGroupLabel(inferFallbackGroup(event.actor_role)),
    title: humanizeFallback(type || "event"),
    actorLabel,
  };
}

function normalizeEventType(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function resolveEventMetadata(event: QuoteEventRecord): Record<string, unknown> {
  if (isRecord(event.metadata)) return event.metadata;
  if (isRecord(event.payload)) return event.payload;
  return {};
}

function formatActorLabel(
  role: QuoteEventActorRole,
  metadata: Record<string, unknown>,
): string | undefined {
  const normalized = (role ?? "").toString().trim().toLowerCase();
  if (normalized === "system" || !normalized) {
    return undefined;
  }
  const actorName =
    readString(metadata, "sender_name") ??
    readString(metadata, "actor_name") ??
    readString(metadata, "name");
  const actorEmail =
    readString(metadata, "sender_email") ??
    readString(metadata, "actor_email") ??
    readString(metadata, "email");

  if (normalized === "supplier") {
    const supplierName = readString(metadata, "supplier_name");
    const identifier = supplierName ?? readString(metadata, "supplier_email") ?? actorName ?? actorEmail;
    return identifier ? `Supplier · ${identifier}` : "Supplier";
  }
  if (normalized === "customer") {
    const identifier =
      readString(metadata, "customer_name") ??
      readString(metadata, "customer_email") ??
      actorName ??
      actorEmail;
    return identifier ? `Customer · ${identifier}` : "Customer";
  }
  if (normalized === "admin") {
    const identifier = readString(metadata, "admin_email") ?? actorEmail ?? actorName;
    return identifier ? `Admin · ${identifier}` : "Admin";
  }
  return undefined;
}

function inferFallbackGroup(role: QuoteEventActorRole): QuoteEventGroupKey {
  const normalized = (role ?? "").toString().trim().toLowerCase();
  if (normalized === "system") return "system";
  return "other";
}

function formatGroupLabel(group: QuoteEventGroupKey): string {
  switch (group) {
    case "rfq":
      return "RFQ";
    case "bids":
      return "Bids";
    case "award":
      return "Award";
    case "kickoff":
      return "Kickoff";
    case "messages":
      return "Messages";
    case "system":
      return "System";
    default:
      return "Other";
  }
}

function joinSubtitle(a: string | null, b: string | null): string | null {
  const first = typeof a === "string" ? a.trim() : "";
  const second = typeof b === "string" ? b.trim() : "";
  if (first && second) return `${first} ${second}`;
  if (first) return first;
  if (second) return second;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBoolean(
  metadata: Record<string, unknown>,
  key: string,
): boolean | null {
  const value = metadata[key];
  if (typeof value === "boolean") return value;
  return null;
}

function readNumber(
  metadata: Record<string, unknown>,
  key: string,
): number | null {
  const value = metadata[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function formatSupplierIdentifier(
  metadata: Record<string, unknown>,
): string | null {
  const supplierName = readString(metadata, "supplier_name");
  if (supplierName) return supplierName;
  const supplierEmail = readString(metadata, "supplier_email");
  if (supplierEmail) return supplierEmail;
  const supplierId = readString(metadata, "supplier_id");
  if (supplierId) return supplierId;
  return null;
}

function humanizeFallback(value: string): string {
  const cleaned = value.replace(/[_-]+/g, " ").trim();
  if (!cleaned) return "Event";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function formatStatusTransitionSubtitle(
  metadata: Record<string, unknown>,
): string | null {
  const fromStatus = readString(metadata, "fromStatus") ?? readString(metadata, "from_status");
  const toStatus = readString(metadata, "toStatus") ?? readString(metadata, "to_status");
  if (!fromStatus || !toStatus) return null;
  return `From ${humanizeFallback(fromStatus)} \u2192 ${humanizeFallback(toStatus)}.`; // →
}

