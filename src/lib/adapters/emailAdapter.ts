import type { BuildOutboundArgs, ProviderAdapter } from "./providerAdapter";
import { resolveProviderDispatchMode } from "./providerDispatchMode";
import {
  formatQuantity,
  formatRequester,
  formatTargetDate,
  formatTurnaround,
  normalizeString,
} from "./rfqContent";

function buildSection(title: string, items: string[], emptyLabel: string): string[] {
  if (items.length === 0) {
    return [title, `- ${emptyLabel}`];
  }
  return [title, ...items];
}

export const emailAdapter: ProviderAdapter = {
  supports(provider) {
    return resolveProviderDispatchMode(provider) === "email";
  },
  buildOutbound(args) {
    const quoteTitle = normalizeString(args.quote.title) || args.quote.id;
    const process = normalizeString(args.quote.process);
    const material = normalizeString(args.quote.material);
    const quantity = formatQuantity(args.quote.quantity);
    const subjectParts = [process, material, quantity ? `Qty ${quantity}` : ""].filter(
      (value) => value.length > 0,
    );
    const subject = subjectParts.length
      ? `Search request: ${quoteTitle} — ${subjectParts.join(" / ")}`
      : `Search request: ${quoteTitle}`;

    const lines: string[] = [];
    const providerName = normalizeString(args.provider.name) || "team";
    lines.push(`Hello ${providerName},`);
    lines.push("");

    const requester = formatRequester(args);
    const contactEmail = normalizeString(args.customer?.email);
    const contactPhone = normalizeString(args.customer?.phone);
    if (requester) {
      lines.push(`Requesting an offer for ${requester}.`);
    } else {
      lines.push("Requesting an offer for a new search request.");
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

    const fileLinks = Array.isArray(args.files) ? args.files : [];
    const files: string[] = fileLinks.map((file, index) => {
      const label = normalizeString(file.label) || `File ${index + 1}`;
      const url = normalizeString(file.url);
      return url ? `- ${label}: ${url}` : `- ${label}`;
    });
    lines.push(...buildSection("Files:", files, "No files available"));
    lines.push("");

    const offerLink = normalizeString(args.destination?.offerLink);
    if (offerLink) {
      lines.push("Offer submission link:");
      lines.push(`- Submit your offer here (no login required): ${offerLink}`);
      lines.push("");
    }

    lines.push("Questions:");
    lines.push("- Price (total and unit)");
    lines.push("- Lead time");
    lines.push("- Assumptions or exclusions");
    lines.push("- Any DFM or manufacturability concerns");
    lines.push("");
    lines.push("Reply to this email with your offer; include any notes/assumptions.");

    return { mode: "email", subject, body: lines.join("\n") };
  },
};
