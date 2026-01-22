import type { BuildOutboundArgs, ProviderAdapter } from "./providerAdapter";
import { resolveProviderDispatchMode } from "./providerDispatchMode";
import {
  formatQuantity,
  formatRequester,
  formatTargetDate,
  normalizeString,
} from "./rfqContent";

function buildRfqDetailsSummary(args: BuildOutboundArgs): string {
  const details: string[] = [];
  const quoteTitle = normalizeString(args.quote.title) || args.quote.id;
  if (quoteTitle) {
    details.push(`Search request: ${quoteTitle}`);
  }
  const process = normalizeString(args.quote.process);
  if (process) details.push(`Process: ${process}`);
  const material = normalizeString(args.quote.material);
  if (material) details.push(`Material: ${material}`);
  const quantity = formatQuantity(args.quote.quantity);
  if (quantity) details.push(`Quantity: ${quantity}`);
  const tolerances = normalizeString(args.quote.tolerances);
  if (tolerances) details.push(`Tolerances: ${tolerances}`);
  const finish = normalizeString(args.quote.finish);
  if (finish) details.push(`Finish: ${finish}`);
  const leadTime = normalizeString(args.quote.desiredLeadTime);
  if (leadTime) details.push(`Lead time: ${leadTime}`);
  const targetDate = formatTargetDate(args.quote.targetDate);
  if (targetDate) details.push(`Target date: ${targetDate}`);

  if (details.length === 0) {
    return "Process, material, quantity, tolerances, finish, and timing.";
  }
  return details.join(" | ");
}

function buildFileUploadSummary(args: BuildOutboundArgs): string {
  const files = Array.isArray(args.files) ? args.files : [];
  if (files.length === 0) {
    return "Upload the CAD files from the search request package.";
  }
  const fileList = files.map((file, index) => {
    const label = normalizeString(file.label) || `File ${index + 1}`;
    const url = normalizeString(file.url);
    return url ? `${label} (${url})` : label;
  });
  return `Upload files: ${fileList.join("; ")}`;
}

function buildRequesterSummary(args: BuildOutboundArgs): string | null {
  const requester = formatRequester(args);
  const contactEmail = normalizeString(args.customer?.email);
  const contactPhone = normalizeString(args.customer?.phone);
  const contactLine = [contactEmail, contactPhone].filter(Boolean).join(" | ");
  const parts = [requester, contactLine].filter(Boolean);
  if (parts.length === 0) return null;
  return parts.join(" — ");
}

function buildWebFormInstructions(args: BuildOutboundArgs, webFormUrl: string | null): string {
  const lines: string[] = [];
  if (webFormUrl) {
    lines.push(`- Open the search request form: ${webFormUrl}`);
  } else {
    lines.push("- Open the provider form (website/portal).");
  }
  lines.push(`- ${buildFileUploadSummary(args)}`);
  lines.push(`- Paste search request details: ${buildRfqDetailsSummary(args)}`);

  const requesterSummary = buildRequesterSummary(args);
  if (requesterSummary) {
    lines.push(`- Include requester/contact info: ${requesterSummary}`);
  } else {
    lines.push("- Include requester/contact info if required.");
  }

  const offerLink = normalizeString(args.destination?.offerLink);
  if (offerLink) {
    lines.push(`- Provide our offer submission link: ${offerLink}`);
  }

  lines.push("- Ask for: price (total and unit), lead time, assumptions/exclusions, DFM concerns.");

  return lines.join("\n");
}

export const webFormAdapter: ProviderAdapter = {
  supports(provider) {
    return resolveProviderDispatchMode(provider) === "web_form";
  },
  buildOutbound(args) {
    const webFormUrl =
      normalizeString(args.provider.rfq_url) || normalizeString(args.provider.website) || null;
    return {
      mode: "web_form",
      webFormUrl,
      webFormInstructions: buildWebFormInstructions(args, webFormUrl),
    };
  },
};
