"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { CopyOutreachEmailButton } from "@/app/admin/providers/CopyOutreachEmailButton";
import {
  bulkHideProvidersInDirectoryAction,
  bulkMarkProvidersRespondedAction,
  bulkShowProvidersInDirectoryAction,
  bulkActivateProvidersAction,
  bulkMarkProvidersContactedAction,
  markProviderContactedAction,
  markProviderRespondedAction,
  toggleProviderDirectoryVisibilityAction,
  toggleProviderActiveAction,
  unverifyProviderAction,
  verifyProviderAction,
} from "@/app/admin/providers/actions";
import { formatDateTime } from "@/lib/formatDate";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";
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

type BulkActionType =
  | "markContacted"
  | "markResponded"
  | "activate"
  | "showDirectory"
  | "hideDirectory";

type ProviderResponseChannel = "email" | "call" | "form";

type NextActionKey =
  | "needs_research"
  | "needs_contact"
  | "awaiting_response"
  | "needs_profile"
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
  needs_profile: {
    label: "Needs profile",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-100",
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
  const [bulkRespondedModalOpen, setBulkRespondedModalOpen] = useState(false);
  const [bulkResponseChannel, setBulkResponseChannel] = useState<ProviderResponseChannel>("email");
  const [bulkResponseSummary, setBulkResponseSummary] = useState("");
  const [bulkResponseRawNotes, setBulkResponseRawNotes] = useState("");
  const [bulkAppendToNotes, setBulkAppendToNotes] = useState(true);
  const [pending, startTransition] = useTransition();

  const selectedCount = selectedProviderIds.size;
  const selectedCountLabel =
    selectedCount > 0 ? `${selectedCount} selected` : "No providers selected";
  const allSelected = selectedCount > 0 && selectedCount === rows.length;
  const bulkBusy = pending || bulkActionType !== null;
  const isBulkMarking = bulkActionType === "markContacted";
  const isBulkResponding = bulkActionType === "markResponded";
  const isBulkActivating = bulkActionType === "activate";
  const isBulkShowing = bulkActionType === "showDirectory";
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

  const handleBulkMarkResponded = () => {
    if (bulkBusy || selectedRows.length === 0) return;
    setFeedback(null);
    setBulkRespondedModalOpen(true);
  };

  const handleBulkRespondedSubmit = () => {
    if (bulkBusy || selectedRows.length === 0) return;
    const summary = bulkResponseSummary.trim();
    if (!summary) {
      setFeedback({ tone: "error", message: "Response summary is required." });
      return;
    }
    setFeedback(null);
    setBulkActionType("markResponded");
    const providerIds = selectedRows.map((row) => row.provider.id);
    startTransition(async () => {
      const result = await bulkMarkProvidersRespondedAction({
        providerIds,
        channel: bulkResponseChannel,
        summary,
        rawNotes: bulkResponseRawNotes.trim() || null,
        appendToNotes: bulkAppendToNotes,
      });
      if (result.ok) {
        setFeedback({ tone: "success", message: result.message });
        setSelectedProviderIds(new Set());
        setBulkRespondedModalOpen(false);
        setBulkResponseSummary("");
        setBulkResponseRawNotes("");
        setBulkResponseChannel("email");
        setBulkAppendToNotes(true);
        router.refresh();
      } else {
        setFeedback({ tone: "error", message: result.error });
      }
      setBulkActionType(null);
    });
  };

  const handleBulkActivate = () => {
    if (bulkBusy || selectedRows.length === 0) return;
    setFeedback(null);
    setBulkActionType("activate");
    const providerIds = selectedRows.map((row) => row.provider.id);
    startTransition(async () => {
      const result = await bulkActivateProvidersAction({ providerIds });
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

  const handleBulkShowDirectory = () => {
    if (bulkBusy || selectedRows.length === 0 || !supportsDirectoryVisibility) return;
    setFeedback(null);
    setBulkActionType("showDirectory");
    const providerIds = selectedRows.map((row) => row.provider.id);
    startTransition(async () => {
      const result = await bulkShowProvidersInDirectoryAction({ providerIds });
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
      <BulkProviderRespondedModal
        isOpen={bulkRespondedModalOpen}
        selectedCount={selectedRows.length}
        channel={bulkResponseChannel}
        summary={bulkResponseSummary}
        rawNotes={bulkResponseRawNotes}
        appendToNotes={bulkAppendToNotes}
        pending={isBulkResponding}
        onClose={() => {
          if (bulkBusy) return;
          setBulkRespondedModalOpen(false);
        }}
        onChangeChannel={setBulkResponseChannel}
        onChangeSummary={setBulkResponseSummary}
        onChangeRawNotes={setBulkResponseRawNotes}
        onChangeAppendToNotes={setBulkAppendToNotes}
        onSubmit={handleBulkRespondedSubmit}
      />
      <tr className="bg-slate-950/60">
        <td colSpan={10} className="px-5 py-4">
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
              <button
                type="button"
                onClick={handleBulkMarkResponded}
                disabled={bulkBusy || selectedRows.length === 0}
                className={clsx(
                  "rounded-full border border-blue-500/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-100 transition",
                  bulkBusy || selectedRows.length === 0
                    ? "cursor-not-allowed opacity-60"
                    : "hover:border-blue-400 hover:text-white",
                )}
              >
                {isBulkResponding ? "Marking..." : "Mark responded"}
              </button>
              <button
                type="button"
                onClick={handleBulkActivate}
                disabled={bulkBusy || selectedRows.length === 0}
                className={clsx(
                  "rounded-full border border-blue-500/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-100 transition",
                  bulkBusy || selectedRows.length === 0
                    ? "cursor-not-allowed opacity-60"
                    : "hover:border-blue-400 hover:text-white",
                )}
              >
                {isBulkActivating ? "Activating..." : "Activate"}
              </button>
              {supportsDirectoryVisibility ? (
                <>
                  <button
                    type="button"
                    onClick={handleBulkShowDirectory}
                    disabled={bulkBusy || selectedRows.length === 0}
                    className={clsx(
                      "rounded-full border border-emerald-500/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-100 transition",
                      bulkBusy || selectedRows.length === 0
                        ? "cursor-not-allowed opacity-60"
                        : "hover:border-emerald-400 hover:text-white",
                    )}
                  >
                    {isBulkShowing ? "Showing..." : "Show in directory"}
                  </button>
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
                </>
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
          supportsDirectoryVisibility={supportsDirectoryVisibility}
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
  supportsDirectoryVisibility,
  onToggleSelect,
}: {
  row: ProviderPipelineRow;
  emailColumnAvailable: boolean;
  opsEvents: OpsEventRecord[];
  selected: boolean;
  disabled: boolean;
  supportsDirectoryVisibility: boolean;
  onToggleSelect: (providerId: string) => void;
}) {
  const {
    provider,
    emailValue,
    websiteValue,
    rfqUrlValue,
    contacted,
    responded,
    lastResponseAt,
    needsResearch,
    isVerified,
    isActive,
  } = row;
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
  const lastResponseLabel = formatRelativeTimeFromTimestamp(toTimestamp(lastResponseAt));
  const profileCompleteness = row.profileCompleteness;
  const profileMissing = profileCompleteness.missing.filter((value) => value.length > 0);
  const profileReadyToVerify = profileCompleteness.readyToVerify;
  const showInDirectory = supportsDirectoryVisibility
    ? Boolean(provider.show_in_directory)
    : provider.verification_status === "verified";
  const nextActionKey = resolveNextActionKey({
    needsResearch,
    contacted,
    isVerified,
    isActive,
    responded,
    profileReadyToVerify,
  });
  const nextActionMeta = NEXT_ACTION_META[nextActionKey];
  const nextActionDetail = buildNextActionDetail(nextActionKey, {
    missingEmail,
    missingWebsite,
    responded,
    profileMissing,
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
          <div className="space-y-2">
            <LifecycleLadder
              steps={[
                { key: "discovered", label: "Discovered", complete: true },
                { key: "contacted", label: "Contacted", complete: contacted },
                { key: "responded", label: "Responded", complete: responded },
                { key: "verified", label: "Verified", complete: isVerified },
                { key: "active", label: "Active", complete: isActive },
                { key: "directory", label: "Directory-visible", complete: showInDirectory },
              ]}
            />
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
          {lastResponseLabel ? (
            <span className="text-xs text-slate-200">{lastResponseLabel}</span>
          ) : (
            <span className="text-slate-500">—</span>
          )}
        </td>
        <td className={clsx(adminTableCellClass, "px-5 py-4")}>
          {provider.source === "discovered" ? (
            <span
              className={pillClass(
                row.discoveryComplete
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-100",
              )}
            >
              {row.discoveryComplete ? "Yes" : "No"}
            </span>
          ) : (
            <span className="text-slate-500">—</span>
          )}
        </td>
        <td className={clsx(adminTableCellClass, "px-5 py-4")}>
          <span
            className={pillClass(
              profileReadyToVerify
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                : "border-amber-500/40 bg-amber-500/10 text-amber-100",
            )}
            title={profileMissing.length > 0 ? profileMissing.join(" · ") : undefined}
          >
            <span className="font-mono">{profileCompleteness.score}</span>
          </span>
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
            {provider.source === "discovered" ? (
              <Link
                href={`/admin/suppliers/discover?editProviderId=${encodeURIComponent(provider.id)}`}
                className="rounded-full border border-slate-700 px-3 py-1 font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white"
              >
                Edit stub
              </Link>
            ) : null}
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
            {!responded && contacted && !isVerified ? (
              <MarkProviderRespondedButton providerId={provider.id} providerName={provider.name} />
            ) : null}

            {provider.verification_status !== "verified" ? (
              <form action={verifyProviderAction}>
                <input type="hidden" name="providerId" value={provider.id} />
                <button
                  type="submit"
                  disabled={!responded || !profileReadyToVerify}
                  title={
                    !responded
                      ? "Mark responded first."
                      : !profileReadyToVerify
                        ? `Complete profile first: ${profileMissing.join(" · ")}`
                        : undefined
                  }
                  className={clsx(
                    "rounded-full border px-3 py-1 font-semibold transition",
                    responded && profileReadyToVerify
                      ? "border-emerald-500/40 text-emerald-100 hover:border-emerald-400 hover:text-white"
                      : "cursor-not-allowed border-slate-800 text-slate-500 opacity-70",
                  )}
                >
                  Ready to verify
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

            {!provider.is_active ? (
              <form action={toggleProviderActiveAction}>
                <input type="hidden" name="providerId" value={provider.id} />
                <input type="hidden" name="nextActive" value="true" />
                <button
                  type="submit"
                  className="rounded-full border border-blue-500/40 px-3 py-1 font-semibold text-blue-100 transition hover:border-blue-400 hover:text-white"
                >
                  Activate
                </button>
              </form>
            ) : (
              <form action={toggleProviderActiveAction}>
                <input type="hidden" name="providerId" value={provider.id} />
                <input type="hidden" name="nextActive" value="false" />
                <button
                  type="submit"
                  className="rounded-full border border-amber-500/40 px-3 py-1 font-semibold text-amber-100 transition hover:border-amber-400 hover:text-white"
                >
                  Deactivate
                </button>
              </form>
            )}

            {supportsDirectoryVisibility ? (
              <form action={toggleProviderDirectoryVisibilityAction}>
                <input type="hidden" name="providerId" value={provider.id} />
                <input
                  type="hidden"
                  name="nextShowInDirectory"
                  value={showInDirectory ? "false" : "true"}
                />
                <button
                  type="submit"
                  className={clsx(
                    "rounded-full border px-3 py-1 font-semibold transition",
                    showInDirectory
                      ? "border-amber-500/40 text-amber-100 hover:border-amber-400 hover:text-white"
                      : "border-emerald-500/40 text-emerald-100 hover:border-emerald-400 hover:text-white",
                  )}
                >
                  {showInDirectory ? "Hide from directory" : "Show in directory"}
                </button>
              </form>
            ) : null}
          </div>
        </td>
      </tr>
      <tr className="bg-slate-950/30">
        <td colSpan={10} className="px-5 pb-5">
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

function MarkProviderRespondedButton({
  providerId,
  providerName,
}: {
  providerId: string;
  providerName: string;
}) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<ProviderResponseChannel>("email");
  const [summary, setSummary] = useState("");
  const [rawNotes, setRawNotes] = useState("");
  const [appendToNotes, setAppendToNotes] = useState(true);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-blue-500/40 px-3 py-1 font-semibold text-blue-100 transition hover:border-blue-400 hover:text-white"
      >
        Mark responded
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Mark supplier responded"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950/95 p-5 text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Mark responded</h3>
            <p className="mt-1 text-sm text-slate-300">
              Capture a structured response for{" "}
              <span className="font-semibold text-slate-100">{providerName}</span>.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:text-white"
          >
            Close
          </button>
        </div>

        <form
          action={markProviderRespondedAction}
          className="mt-4 space-y-3"
          onSubmit={() => setOpen(false)}
        >
          <input type="hidden" name="providerId" value={providerId} />
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Channel
            </label>
            <select
              name="channel"
              value={channel}
              onChange={(event) => setChannel(event.target.value as ProviderResponseChannel)}
              className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
            >
              <option value="email">Email</option>
              <option value="call">Call</option>
              <option value="form">Web form</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Summary
            </label>
            <textarea
              name="summary"
              required
              rows={3}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="e.g. Can quote, needs 2D drawing; 3–5 day lead time estimate…"
              className="w-full resize-y rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
              maxLength={1000}
            />
            <p className="text-xs text-slate-500">Keep this short and reportable.</p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Notes (optional)
            </label>
            <textarea
              name="rawNotes"
              rows={5}
              value={rawNotes}
              onChange={(event) => setRawNotes(event.target.value)}
              placeholder="Paste the raw reply, context, or call notes (optional)…"
              className="w-full resize-y rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
              maxLength={5000}
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              name="appendToNotes"
              value="true"
              checked={appendToNotes}
              onChange={(event) => setAppendToNotes(event.target.checked)}
              className="h-4 w-4 rounded border-slate-700 bg-slate-950/60 text-emerald-500"
            />
            Append a brief line to provider notes (for humans)
          </label>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full border border-slate-800 bg-slate-950/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 hover:border-slate-600 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-full bg-blue-500 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-blue-950 hover:bg-blue-400"
            >
              Save response
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BulkProviderRespondedModal({
  isOpen,
  selectedCount,
  channel,
  summary,
  rawNotes,
  appendToNotes,
  pending,
  onClose,
  onChangeChannel,
  onChangeSummary,
  onChangeRawNotes,
  onChangeAppendToNotes,
  onSubmit,
}: {
  isOpen: boolean;
  selectedCount: number;
  channel: ProviderResponseChannel;
  summary: string;
  rawNotes: string;
  appendToNotes: boolean;
  pending: boolean;
  onClose: () => void;
  onChangeChannel: (value: ProviderResponseChannel) => void;
  onChangeSummary: (value: string) => void;
  onChangeRawNotes: (value: string) => void;
  onChangeAppendToNotes: (value: boolean) => void;
  onSubmit: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Bulk mark responded"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950/95 p-5 text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Bulk mark responded</h3>
            <p className="mt-1 text-sm text-slate-300">
              Apply one response record to{" "}
              <span className="font-semibold text-slate-100">
                {selectedCount} provider{selectedCount === 1 ? "" : "s"}
              </span>
              .
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className={clsx(
              "rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:text-white",
              pending ? "cursor-not-allowed opacity-60" : null,
            )}
          >
            Close
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Channel
            </label>
            <select
              value={channel}
              onChange={(event) => onChangeChannel(event.target.value as ProviderResponseChannel)}
              className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
            >
              <option value="email">Email</option>
              <option value="call">Call</option>
              <option value="form">Web form</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Summary
            </label>
            <textarea
              value={summary}
              onChange={(event) => onChangeSummary(event.target.value)}
              rows={3}
              placeholder="Short, reportable summary…"
              className="w-full resize-y rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
              maxLength={1000}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Notes (optional)
            </label>
            <textarea
              value={rawNotes}
              onChange={(event) => onChangeRawNotes(event.target.value)}
              rows={5}
              placeholder="Optional raw notes…"
              className="w-full resize-y rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
              maxLength={5000}
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={appendToNotes}
              onChange={(event) => onChangeAppendToNotes(event.target.checked)}
              className="h-4 w-4 rounded border-slate-700 bg-slate-950/60 text-emerald-500"
            />
            Append a brief line to provider notes (for humans)
          </label>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className={clsx(
                "rounded-full border border-slate-800 bg-slate-950/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 hover:border-slate-600 hover:text-white",
                pending ? "cursor-not-allowed opacity-60" : null,
              )}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={pending}
              className={clsx(
                "rounded-full bg-blue-500 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-blue-950 hover:bg-blue-400",
                pending ? "cursor-not-allowed opacity-60" : null,
              )}
            >
              {pending ? "Saving..." : "Save responses"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LifecycleLadder({
  steps,
}: {
  steps: Array<{ key: string; label: string; complete: boolean }>;
}) {
  const firstIncompleteIndex = steps.findIndex((step) => !step.complete);
  const currentIndex = firstIncompleteIndex === -1 ? steps.length - 1 : firstIncompleteIndex;

  return (
    <ol className="flex flex-wrap items-center gap-1">
      {steps.map((step, index) => {
        const complete = step.complete;
        const current = index === currentIndex && !complete;
        return (
          <li key={step.key} className="flex items-center gap-1">
            <span
              className={pillClass(
                complete
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                  : current
                    ? "border-blue-500/40 bg-blue-500/10 text-blue-100"
                    : "border-slate-800 bg-slate-950/60 text-slate-400",
              )}
            >
              {step.label}
            </span>
            {index < steps.length - 1 ? <span className="text-[11px] text-slate-600">→</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

function resolveNextActionKey(args: {
  needsResearch: boolean;
  contacted: boolean;
  isVerified: boolean;
  isActive: boolean;
  responded: boolean;
  profileReadyToVerify: boolean;
}): NextActionKey {
  if (args.needsResearch) {
    return "needs_research";
  }
  if (!args.contacted) {
    return "needs_contact";
  }
  if (!args.isVerified && args.responded && !args.profileReadyToVerify) {
    return "needs_profile";
  }
  if (!args.isVerified && args.responded) {
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
  args: {
    missingEmail: boolean;
    missingWebsite: boolean;
    responded: boolean;
    profileMissing: string[];
  },
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
      return args.responded ? "Response logged" : null;
    case "needs_profile": {
      if (args.profileMissing.length === 0) return "Missing profile details";
      const detail = args.profileMissing.slice(0, 3).join(" · ");
      return args.profileMissing.length > 3 ? `${detail} · …` : detail;
    }
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
    case "provider_responded": {
      const note = resolvePayloadString(payload, "response_notes");
      return note ? `Response logged (${note.slice(0, 80)}${note.length > 80 ? "…" : ""})` : "Response logged";
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
    case "supplier_discovery_updated": {
      const supplierName = resolvePayloadString(payload, "supplier_name");
      const website = resolvePayloadString(payload, "supplier_website");
      if (supplierName && website) return `Supplier discovery updated (${supplierName} · ${website})`;
      if (supplierName) return `Supplier discovery updated (${supplierName})`;
      if (website) return `Supplier discovery updated (${website})`;
      return "Supplier discovery updated";
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
