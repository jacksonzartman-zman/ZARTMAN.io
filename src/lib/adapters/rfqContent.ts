import { formatDateTime } from "@/lib/formatDate";
import type { BuildOutboundArgs } from "./providerAdapter";

export function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function formatQuantity(value: BuildOutboundArgs["quote"]["quantity"]): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  const asText = normalizeString(value);
  return asText || null;
}

export function formatTargetDate(value: string | null | undefined): string | null {
  const trimmed = normalizeString(value);
  if (!trimmed) return null;
  const formatted = formatDateTime(trimmed, { fallback: "" });
  return formatted || trimmed;
}

export function formatRequester(args: BuildOutboundArgs): string | null {
  const name = normalizeString(args.customer?.name);
  const company = normalizeString(args.customer?.company);
  if (name && company && name !== company) {
    return `${name} (${company})`;
  }
  if (company) return company;
  if (name) return name;
  return null;
}

export function formatTurnaround(args: BuildOutboundArgs): string {
  const leadTime = normalizeString(args.quote.desiredLeadTime);
  const targetDate = formatTargetDate(args.quote.targetDate);
  if (leadTime) return leadTime;
  if (targetDate) return `Target date ${targetDate}`;
  return "Not specified";
}
