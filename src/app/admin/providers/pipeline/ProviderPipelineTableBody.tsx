"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { CopyOutreachEmailButton } from "@/app/admin/providers/CopyOutreachEmailButton";
import {
  bulkHideProvidersInDirectoryAction,
  bulkMarkProvidersContactedAction,
  markProviderContactedAction,
  toggleProviderActiveAction,
  unverifyProviderAction,
  verifyProviderAction,
} from "@/app/admin/providers/actions";
import { formatDateTime } from "@/lib/formatDate";
import { formatShortId } from "@/lib/awards";
import type { OpsEventRecord } from "@/server/ops/events";
import type { ProviderPipelineRow } from "@/server/providers/pipeline";
import type { ProviderCapabilityMatchHealth } from "@/lib/provider/capabilityMatch";

type ProviderPipelineTableBodyProps = {
  rows: ProviderPipelineRow[];
  emailColumnAvailable: boolean;
  opsEventsByProviderId: Record<string, OpsEventRecord[]>;
  supportsDirectoryVisibility: boolean;
};

type FeedbackTone = "success" | "error";

type FeedbackState = {
  tone: FeedbackTone;
  message: string;
};

type BulkActionType = "markContacted" | "hideDirectory";

type NextActionKey =
  | "needs_research"
  | "needs_contact"
  | "awaiting_response"
  | "ready_to_verify"
  | "ready_to_activate"
  | "up_to_date";

const adminTableCellClass =
  "px-3 py-2 text-left align-middle text-sm text-slate-200";

const NEXT_ACTION_META: Record<NextActionKey, { label: string; className: string }> = {
  needs_research: {
    label: "Needs research",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-100",
  },
  needs_contact: {
    label: "Needs contact",
    className: "border-slate-700 bg-slate-900/60 text-slate-200",
  },
  awaiting_response: {
    label: "Awaiting response",
    className: "border-blue-500/40 bg-blue-500/10 text-blue-100",
  },
  ready_to_verify: {
    label: "Ready to verify",
    className: "border-teal-500/40 bg-teal-500/10 text-teal-100",
  },
  ready_to_activate: {
    label: "Ready to activate",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
  },
  up_to_date: {
    label: "Up to date",
    className: "border-slate-700 bg-slate-900/60 text-slate-200",
  },
};

export default function ProviderPipelineTableBody({
  rows,
  emailColumnAvailable,
  opsEventsByProviderId,
  supportsDirectoryVisibility,
}: ProviderPipelineTableBodyProps) {
  const router = useRouter();
  const [selectedProviderIds, setSelectedProviderIds] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [bulkActionType, setBulkActionType] = useState<BulkActionType | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedCount = selectedProviderIds.size;
  const selectedCountLabel =
    selectedCount > 0 ? `${selectedCount} selected` : "No providers selected";
  const allSelected = selectedCount > 0 && selectedCount === rows.length;
  const bulkBusy = pending || bulkActionType !== null;
  const isBulkMarking = bulkActionType === "markContacted";
  const isBulkHiding = bulkActionType === "hideDirectory";

  const selectedRows = useMemo(() => {
    if (selectedProviderIds.size === 0) return [];
    return rows.filter((row) => selectedProviderIds.has(row.provider.id));
  }, [rows, selectedProviderIds]);

  const toggleProviderSelected = (providerId: string) => {
    setSelectedProviderIds((prev) => {
      const next = new Set(prev);
      if (next.has(providerId)) {
        next.delete(providerId);
      } else {
        next.add(providerId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (bulkBusy) return;
    setSelectedProviderIds((prev) => {
      if (prev.size === rows.length) {
        return new Set();
      }
      return new Set(rows.map((row) => row.provider.id));
    });
  };

  const handleBulkMarkContacted = () => {
    if (bulkBusy || selectedRows.length === 0) return;
    setFeedback(null);
    setBulkActionType("markContacted");
    const providerIds = selectedRows.map((row) => row.provider.id);
    startTransition(async () => {
      const result = await bulkMarkProvidersContactedAction({ providerIds });
      if (result.ok) {
        setFeedback({ tone: "success", message: result.message });
        setSelectedProviderIds(new Set());
        router.refresh();
      } else {
        setFeedback({ tone: "error", message: result.error });
      }
      setBulkActionType(null);
    });
  };

  const handleBulkHideDirectory = () => {
    if (bulkBusy || selectedRows.length === 0 || !supportsDirectoryVisibility) return;
    setFeedback(null);
    setBulkActionType("hideDirectory");
    const providerIds = selectedRows.map((row) => row.provider.id);
    startTransition(async () => {
      const result = await bulkHideProvidersInDirectoryAction({ providerIds });
      if (result.ok) {
        setFeedback({ tone: "success", message: result.message });
        setSelectedProviderIds(new Set());
        router.refresh();
      } else {
        setFeedback({ tone: "error", message: result.error });
      }
      setBulkActionType(null);
    });
  };

  return (
    <>
      <tr className="bg-slate-950/60">
        <td colSpan={7} className="px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Bulk actions
              </p>
              <p className="text-sm text-slate-200">{selectedCountLabel}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  disabled={bulkBusy || rows.length === 0}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-950/60 text-emerald-500"
                />
                Select all
              </label>
              <button
                type="button"
                onClick={handleBulkMarkContacted}
                disabled={bulkBusy || selectedRows.length === 0}
                className={clsx(
                  "rounded-full border border-slate-700 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-200 transition",
                  bulkBusy || selectedRows.length === 0
                    ? "cursor-not-allowed opacity-60"
                    : "hover:border-slate-500 hover:text-white",
                )}
              >
                {isBulkMarking ? "Marking..." : "Mark contacted"}
              </button>
              {supportsDirectoryVisibility ? (
                <button
                  type="button"
                  onClick={handleBulkHideDirectory}
                  disabled={bulkBusy || selectedRows.length === 0}
                  className={clsx(
                    "rounded-full border border-amber-500/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-100 transition",
                    bulkBusy || selectedRows.length === 0
                      ? "cursor-not-allowed opacity-60"
                      : "hover:border-amber-400 hover:text-white",
                  )}
                >
                  {isBulkHiding ? "Hiding..." : "Hide in directory"}
                </button>
              ) : null}
            </div>
          </div>
          {feedback ? (
            <p
              className={clsx(
                "mt-3 rounded-xl border px-3 py-2 text-xs",
                feedback.tone === "success"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-100",
              )}
              role={feedback.tone === "success" ? "status" : "alert"}
            >
              {feedback.message}
            </p>
          ) : null}
        </td>
      </tr>
      {rows.map((row) => (
        <ProviderPipelineRowDisplay
          key={row.provider.id}
          row={row}
          emailColumnAvailable={emailColumnAvailable}
          opsEvents={opsEventsByProviderId[row.provider.id] ?? []}
          selected={selectedProviderIds.has(row.provider.id)}
          disabled={bulkBusy}
          onToggleSelect={toggleProviderSelected}
        />
      ))}
    </>
  );
}

function ProviderPipelineRowDisplay({
  row,
  emailColumnAvailable,
  opsEvents,
  selected,
  disabled,
  onToggleSelect,
}: {
  row: ProviderPipelineRow;
  emailColumnAvailable: boolean;
  opsEvents: OpsEventRecord[];
  selected: boolean;
  disabled: boolean;
  onToggleSelect: (providerId: string) => void;
}) {
  const { provider, emailValue, websiteValue, rfqUrlValue, contacted, needsResearch, isVerified, isActive } =
    row;
  const matchPill = capabilityMatchPill(row.capabilityMatch.health);
  const matchTitle = buildCapabilityMatchTitle(row.capabilityMatch);
  const websiteHref = normalizeWebsiteHref(websiteValue);
  const rfqUrlHref = normalizeWebsiteHref(rfqUrlValue);
  const openWebsiteHref = websiteHref ?? rfqUrlHref;
  const activeMeta = activePill(isActive);
  const verificationMeta = verificationPill(provider.verification_status);
  const contactMeta = contactedPill(contacted);
  const contactedAtLabel = provider.contacted_at
    ? formatDateTime(provider.contacted_at, { includeTime: true })
    : null;
  const outreachSubject = buildOutreachEmailSubject(provider.name);
  const outreachBody = buildOutreachEmailBody(provider.name);
  const missingEmail = !emailValue;
  const missingWebsite = !websiteValue && !rfqUrlValue;
  const hasResponseNotes = hasResponseNotesFlag(provider.notes);
  const nextActionKey = resolveNextActionKey({
    needsResearch,
    contacted,
    isVerified,
    isActive,
    hasResponseNotes,
  });
  const nextActionMeta = NEXT_ACTION_META[nextActionKey];
  const nextActionDetail = buildNextActionDetail(nextActionKey, {
    missingEmail,
    missingWebsite,
    hasResponseNotes,
  });

  return (
    <Fragment>
      <tr className="bg-slate-950/40 transition hover:bg-slate-900/40">
        <td className={clsx(adminTableCellClass, "px-5 py-4")}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(provider.id)}
            disabled={disabled}
            aria-label={`Select ${provider.name}`}
            className="h-4 w-4 rounded border-slate-700 bg-slate-950/60 text-emerald-500"
          />
        </td>
        <td className={clsx(adminTableCellClass, "px-5 py-4")}>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-100">{provider.name}</p>
            <p className="text-xs text-slate-500">{provider.id}</p>
            <p className="text-[11px] text-slate-400">{formatEnumLabel(provider.source)}</p>
          </div>
        </td>
        <td className={clsx(adminTableCellClass, "px-5 py-4")}>
          <div className="space-y-1 text-xs text-slate-300">
            {emailValue ? (
              <span>{emailValue}</span>
            ) : emailColumnAvailable ? (
              <span>—</span>
            ) : (
              <span className="text-slate-500">Email unavailable</span>
            )}
            {websiteValue ? (
              websiteHref ? (
                <Link href={websiteHref} className="text-emerald-200 hover:text-emerald-100">
                  {websiteValue}
                </Link>
              ) : (
                <span>{websiteValue}</span>
              )
            ) : (
              <span className="text-slate-500">Website —</span>
            )}
            {rfqUrlValue ? (
              rfqUrlHref ? (
                <Link href={rfqUrlHref} className="text-emerald-200 hover:text-emerald-100">
                  {rfqUrlValue}
                </Link>
              ) : (
                <span>{rfqUrlValue}</span>
              )
            ) : (
              <span className="text-slate-500">RFQ URL —</span>
            )}
          </div>
        </td>
        <td className={clsx(adminTableCellClass, "px-5 py-4")}>
          <details className="group min-w-[140px]">
            <summary
              className={clsx(
                "inline-flex cursor-pointer list-none items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                matchPill.className,
              )}
              title={matchTitle}
            >
              {matchPill.label}
              {typeof row.capabilityMatch.score === "number" ? (
                <span className="font-mono text-[10px] opacity-80">{row.capabilityMatch.score}</span>
              ) : null}
            </summary>
            {row.capabilityMatch.health !== "unknown" ? (
              <div className="mt-2 space-y-2 rounded-xl border border-slate-900/60 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">
                {row.capabilityMatch.mismatchReasons.length > 0 ? (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Mismatch reasons
                    </p>
                    <ul className="mt-1 list-disc pl-4">
                      {row.capabilityMatch.mismatchReasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {row.capabilityMatch.partialMatches.length > 0 ? (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Partial matches
                    </p>
                    <ul className="mt-1 list-disc pl-4">
                      {row.capabilityMatch.partialMatches.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {row.capabilityMatch.matches.length > 0 ? (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Matches
                    </p>
                    <ul className="mt-1 list-disc pl-4">
                      {row.capabilityMatch.matches.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {typeof row.capabilityMatch.score === "number" ? (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Score breakdown
                    </p>
                    <ul className="mt-1 space-y-1">
                      {row.capabilityMatch.breakdown
                        .filter((item) => item.available)
                        .map((item) => (
                          <li key={item.key} className="flex justify-between gap-3">
                            <span className="text-slate-300">{item.label}</span>
                            <span className="font-mono text-slate-400">
                              {item.earned}/{item.weight}
                            </span>
                          </li>
                        ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </details>
        </td>
        <td className={clsx(adminTableCellClass, "px-5 py-4")}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={pillClass(contactMeta.className)}>{contactMeta.label}</span>
            <span className={pillClass(verificationMeta.className)}>{verificationMeta.label}</span>
            <span className={pillClass(activeMeta.className)}>{activeMeta.label}</span>
            {needsResearch ? (
              <span className={pillClass("border-amber-500/40 bg-amber-500/10 text-amber-100")}>
                Needs research
              </span>
            ) : null}
          </div>
          {contactedAtLabel ? (
            <p className="mt-2 text-[11px] text-slate-500">Contacted {contactedAtLabel}</p>
          ) : null}
        </td>
        <td className={clsx(adminTableCellClass, "px-5 py-4")}>
          <div className="space-y-2">
            <span className={pillClass(nextActionMeta.className)}>{nextActionMeta.label}</span>
            {nextActionDetail ? (
              <p className="text-[11px] text-slate-500">{nextActionDetail}</p>
            ) : null}
          </div>
        </td>
        <td className={clsx(adminTableCellClass, "px-5 py-4")}>
          <div className="flex flex-col gap-2 text-xs">
            {openWebsiteHref ? (
              <a
                href={openWebsiteHref}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-slate-700 px-3 py-1 font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white"
              >
                Open website
              </a>
            ) : null}
            {emailValue ? (
              <CopyOutreachEmailButton subject={outreachSubject} body={outreachBody} />
            ) : null}
            {contacted ? (
              <span className="text-slate-400">Contacted</span>
            ) : (
              <form action={markProviderContactedAction}>
                <input type="hidden" name="providerId" value={provider.id} />
                <button
                  type="submit"
                  className="rounded-full border border-slate-700 px-3 py-1 font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white"
                >
                  Mark contacted
                </button>
              </form>
            )}
            {provider.verification_status !== "verified" ? (
              <form action={verifyProviderAction}>
                <input type="hidden" name="providerId" value={provider.id} />
                <button
                  type="submit"
                  className="rounded-full border border-emerald-500/40 px-3 py-1 font-semibold text-emerald-100 transition hover:border-emerald-400 hover:text-white"
                >
                  Verify
                </button>
              </form>
            ) : (
              <form action={unverifyProviderAction}>
                <input type="hidden" name="providerId" value={provider.id} />
                <button
                  type="submit"
                  className="rounded-full border border-amber-500/40 px-3 py-1 font-semibold text-amber-100 transition hover:border-amber-400 hover:text-white"
                >
                  Unverify
                </button>
              </form>
            )}
            <form action={toggleProviderActiveAction}>
              <input type="hidden" name="providerId" value={provider.id} />
              <input type="hidden" name="nextActive" value={provider.is_active ? "false" : "true"} />
              <button
                type="submit"
                className={clsx(
                  "rounded-full border px-3 py-1 font-semibold transition",
                  provider.is_active
                    ? "border-amber-500/40 text-amber-100 hover:border-amber-400 hover:text-white"
                    : "border-blue-500/40 text-blue-100 hover:border-blue-400 hover:text-white",
                )}
              >
                {provider.is_active ? "Deactivate" : "Activate"}
              </button>
            </form>
          </div>
        </td>
      </tr>
      <tr className="bg-slate-950/30">
        <td colSpan={7} className="px-5 pb-5">
          <details className="rounded-xl border border-slate-900/70 bg-slate-950/40 px-4 py-3">
            <summary className="cursor-pointer font-semibold text-slate-200">
              Ops timeline ({opsEvents.length})
            </summary>
            <div className="mt-3">
              {opsEvents.length === 0 ? (
                <p className="text-xs text-slate-400">No ops events yet.</p>
              ) : (
                <div className="divide-y divide-slate-900/60">
                  {opsEvents.map((event) => {
                    const timestamp =
                      formatDateTime(event.created_at, { includeTime: true }) ?? event.created_at;
                    return (
                      <div
                        key={event.id}
                        className="grid gap-3 py-3 sm:grid-cols-[150px_minmax(0,1fr)]"
                      >
                        <div className="text-xs text-slate-400">{timestamp}</div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-100">
                            {formatOpsEventTypeLabel(event.event_type)}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-400">
                            {renderProviderOpsEventSummary(event)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </details>
        </td>
      </tr>
    </Fragment>
  );
}

function resolveNextActionKey(args: {
  needsResearch: boolean;
  contacted: boolean;
  isVerified: boolean;
  isActive: boolean;
  hasResponseNotes: boolean;
}): NextActionKey {
  if (args.needsResearch) {
    return "needs_research";
  }
  if (!args.contacted) {
    return "needs_contact";
  }
  if (!args.isVerified && args.hasResponseNotes) {
    return "ready_to_verify";
  }
  if (!args.isVerified) {
    return "awaiting_response";
  }
  if (args.isVerified && !args.isActive) {
    return "ready_to_activate";
  }
  return "up_to_date";
}

function buildNextActionDetail(
  key: NextActionKey,
  args: { missingEmail: boolean; missingWebsite: boolean; hasResponseNotes: boolean },
): string | null {
  switch (key) {
    case "needs_research": {
      const missing = [
        args.missingEmail ? "Email" : null,
        args.missingWebsite ? "Website" : null,
      ].filter((value): value is string => Boolean(value));
      return missing.length > 0 ? `Missing ${missing.join(" · ")}` : null;
    }
    case "ready_to_verify":
      return args.hasResponseNotes ? "Response notes flagged" : null;
    case "awaiting_response":
      return "Awaiting reply";
    case "ready_to_activate":
      return "Verified, inactive";
    case "needs_contact":
      return "Outreach not logged";
    default:
      return null;
  }
}

function formatEnumLabel(value?: string | null): string {
  if (!value) return "";
  const collapsed = value.replace(/[_-]+/g, " ").trim();
  if (!collapsed) return "";
  return collapsed
    .split(" ")
    .map((segment) => (segment ? segment[0].toUpperCase() + segment.slice(1) : ""))
    .join(" ");
}

function formatOpsEventTypeLabel(value: string): string {
  const label = formatEnumLabel(value);
  return label || "Event";
}

function renderProviderOpsEventSummary(event: OpsEventRecord): string {
  const payload = event.payload ?? {};
  switch (event.event_type) {
    case "destination_submitted": {
      const quoteId = resolvePayloadString(payload, "quote_id");
      const destinationId = resolvePayloadString(payload, "destination_id");
      const details = [
        quoteId ? `Quote ${formatShortId(quoteId)}` : null,
        destinationId ? `Dest ${formatShortId(destinationId)}` : null,
      ].filter((detail): detail is string => Boolean(detail));
      return details.length > 0
        ? `Destination submitted (${details.join(" / ")})`
        : "Destination submitted";
    }
    case "provider_contacted": {
      const email = resolvePayloadString(payload, "provider_email");
      return email ? `Outreach logged (${email})` : "Outreach logged";
    }
    case "provider_verified":
      return "Verification marked verified";
    case "provider_unverified":
      return "Verification reset";
    case "provider_activated":
      return "Provider activated";
    case "provider_deactivated":
      return "Provider deactivated";
    case "provider_directory_visibility_changed": {
      const showInDirectory = resolvePayloadBoolean(payload, "show_in_directory");
      if (showInDirectory === null) {
        return "Directory visibility updated";
      }
      return showInDirectory ? "Directory visibility enabled" : "Directory hidden";
    }
    case "supplier_invited": {
      const supplierName = resolvePayloadString(payload, "supplier_name");
      return supplierName ? `Supplier invited (${supplierName})` : "Supplier invited";
    }
    case "supplier_discovered": {
      const supplierName = resolvePayloadString(payload, "supplier_name");
      const website = resolvePayloadString(payload, "supplier_website");
      if (supplierName && website) return `Supplier discovered (${supplierName} · ${website})`;
      if (supplierName) return `Supplier discovered (${supplierName})`;
      if (website) return `Supplier discovered (${website})`;
      return "Supplier discovered";
    }
    default:
      return "Ops event recorded";
  }
}

function resolvePayloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolvePayloadBoolean(payload: Record<string, unknown>, key: string): boolean | null {
  const value = payload[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

function normalizeWebsiteHref(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const hasScheme = /^https?:\/\//i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function buildOutreachEmailSubject(providerName: string): string {
  const name = normalizeOutreachName(providerName);
  return name ? `Quote request for ${name}` : "Quote request";
}

function buildOutreachEmailBody(providerName: string): string {
  const name = normalizeOutreachName(providerName);
  const greeting = name ? `Hi ${name} team,` : "Hi there,";
  return [
    greeting,
    "",
    "We're looking to request a quote for a customer part.",
    "Are you able to quote from STEP files and drawings?",
    "",
    "If so, please reply with your preferred contact and any quoting requirements.",
    "",
    "Thanks,",
    "Zartman Team",
  ].join("\n");
}

function normalizeOutreachName(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pillClass(colorClasses: string): string {
  return clsx(
    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
    colorClasses,
  );
}

function contactedPill(contacted: boolean): { label: string; className: string } {
  return contacted
    ? { label: "Contacted", className: "border-blue-500/40 bg-blue-500/10 text-blue-100" }
    : { label: "Not contacted", className: "border-slate-700 bg-slate-900/60 text-slate-200" };
}

function activePill(isActive: boolean): { label: string; className: string } {
  return isActive
    ? { label: "Active", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100" }
    : { label: "Inactive", className: "border-slate-700 bg-slate-900/60 text-slate-200" };
}

function verificationPill(status: string): { label: string; className: string } {
  if (status === "verified") {
    return { label: "Verified", className: "border-blue-500/40 bg-blue-500/10 text-blue-100" };
  }
  return { label: "Unverified", className: "border-amber-500/40 bg-amber-500/10 text-amber-100" };
}

function hasResponseNotesFlag(notes: string | null): boolean {
  if (!notes) return false;
  const lines = notes.split("\n");
  return lines.some((line) => {
    const trimmed = line.trim().toLowerCase();
    if (!trimmed) return false;
    if (trimmed.startsWith("response notes:")) return true;
    if (trimmed.startsWith("response:")) return true;
    if (trimmed.startsWith("[response]")) return true;
    if (trimmed.startsWith("#response")) return true;
    return false;
  });
}

function capabilityMatchPill(
  health: ProviderCapabilityMatchHealth,
): { label: string; className: string } {
  switch (health) {
    case "match":
      return { label: "Match", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100" };
    case "partial":
      return { label: "Partial", className: "border-amber-500/40 bg-amber-500/10 text-amber-100" };
    case "mismatch":
      return { label: "Mismatch", className: "border-red-500/40 bg-red-500/10 text-red-100" };
    default:
      return { label: "—", className: "border-slate-800 bg-slate-950/60 text-slate-200" };
  }
}

function buildCapabilityMatchTitle(
  assessment: ProviderPipelineRow["capabilityMatch"],
): string {
  const parts: string[] = [];
  if (assessment.mismatchReasons.length > 0) {
    parts.push(`Mismatch: ${assessment.mismatchReasons.join(" ")}`);
  }
  if (assessment.partialMatches.length > 0) {
    parts.push(`Partial: ${assessment.partialMatches.join(" ")}`);
  }
  if (assessment.matches.length > 0) {
    parts.push(`Matches: ${assessment.matches.join(" ")}`);
  }
  if (typeof assessment.score === "number") {
    parts.push(`Score: ${assessment.score}`);
  }
  return parts.join(" · ") || "Match health unavailable";
}
