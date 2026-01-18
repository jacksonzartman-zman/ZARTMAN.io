import { formatDateTime } from "@/lib/formatDate";
import type { BuildOutboundRfqArgs, ProviderAdapter } from "./providerAdapter";

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatQuantity(value: BuildOutboundRfqArgs["quote"]["quantity"]): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  const asText = normalizeString(value);
  return asText || null;
}

function formatTargetDate(value: string | null | undefined): string | null {
  const trimmed = normalizeString(value);
  if (!trimmed) return null;
  const formatted = formatDateTime(trimmed, { fallback: "" });
  return formatted || trimmed;
}

function formatRequester(args: BuildOutboundRfqArgs): string | null {
  const name = normalizeString(args.customer?.name);
  const company = normalizeString(args.customer?.company);
  if (name && company && name !== company) {
    return `${name} (${company})`;
  }
  if (company) return company;
  if (name) return name;
  return null;
}

function formatTurnaround(args: BuildOutboundRfqArgs): string {
  const leadTime = normalizeString(args.quote.desiredLeadTime);
  const targetDate = formatTargetDate(args.quote.targetDate);
  if (leadTime) return leadTime;
  if (targetDate) return `Target date ${targetDate}`;
  return "Not specified";
}

function buildSection(title: string, items: string[], emptyLabel: string): string[] {
  if (items.length === 0) {
    return [title, `- ${emptyLabel}`];
  }
  return [title, ...items];
}

export const emailAdapter: ProviderAdapter = {
  supports(provider) {
    return provider.quoting_mode === "email";
  },
  buildOutboundRfq(args) {
    const quoteTitle = normalizeString(args.quote.title) || args.quote.id;
    const process = normalizeString(args.quote.process);
    const material = normalizeString(args.quote.material);
    const quantity = formatQuantity(args.quote.quantity);
    const subjectParts = [process, material, quantity ? `Qty ${quantity}` : ""].filter(
      (value) => value.length > 0,
    );
    const subject = subjectParts.length
      ? `RFQ: ${quoteTitle} — ${subjectParts.join(" / ")}`
      : `RFQ: ${quoteTitle}`;

    const lines: string[] = [];
    const providerName = normalizeString(args.provider.name) || "team";
    lines.push(`Hello ${providerName},`);
    lines.push("");

    const requester = formatRequester(args);
    const contactEmail = normalizeString(args.customer?.email);
    const contactPhone = normalizeString(args.customer?.phone);
    if (requester) {
      lines.push(`Requesting a quote for ${requester}.`);
    } else {
      lines.push("Requesting a quote for a new RFQ.");
    }
    if (contactEmail || contactPhone) {
      const contactLine = [contactEmail, contactPhone].filter(Boolean).join(" | ");
      lines.push(`Contact: ${contactLine}`);
    }
    lines.push(`Requested turnaround: ${formatTurnaround(args)}.`);
    lines.push("");

    const partSummary: string[] = [];
    if (process) partSummary.push(`- Process: ${process}`);
    if (material) partSummary.push(`- Material: ${material}`);
    if (quantity) partSummary.push(`- Quantity: ${quantity}`);
    const tolerances = normalizeString(args.quote.tolerances);
    if (tolerances) partSummary.push(`- Tolerances: ${tolerances}`);
    const finish = normalizeString(args.quote.finish);
    if (finish) partSummary.push(`- Finish: ${finish}`);
    lines.push(...buildSection("Part summary:", partSummary, "Not specified"));
    lines.push("");

    const timing: string[] = [];
    const leadTime = normalizeString(args.quote.desiredLeadTime);
    if (leadTime) timing.push(`- Desired lead time: ${leadTime}`);
    const targetDate = formatTargetDate(args.quote.targetDate);
    if (targetDate) timing.push(`- Target date: ${targetDate}`);
    lines.push(...buildSection("Timing:", timing, "Not specified"));
    lines.push("");

    const fileLinks = Array.isArray(args.fileLinks) ? args.fileLinks : [];
    const files: string[] = fileLinks.map((file, index) => {
      const label = normalizeString(file.label) || `File ${index + 1}`;
      const url = normalizeString(file.url);
      return url ? `- ${label}: ${url}` : `- ${label}`;
    });
    lines.push(...buildSection("Files:", files, "No files available"));
    lines.push("");

    const offerLink = normalizeString(args.offerLink);
    if (offerLink) {
      lines.push("Quote submission link:");
      lines.push(`- Submit your quote here (no login required): ${offerLink}`);
      lines.push("");
    }

    lines.push("Questions:");
    lines.push("- Price (total and unit)");
    lines.push("- Lead time");
    lines.push("- Assumptions or exclusions");
    lines.push("- Any DFM or manufacturability concerns");
    lines.push("");
    lines.push("Reply to this email with your quote; include any notes/assumptions.");

    return { subject, body: lines.join("\n") };
  },
};
