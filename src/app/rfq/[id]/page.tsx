import type { ReactNode } from "react";
import { formatDateTime } from "@/lib/formatDate";
import {
  loadRfqWorkspace,
  type RfqCollaborationThread,
  type RfqWorkspaceData,
  type RfqWorkspaceViewerRole,
} from "@/server/workspaces/rfqWorkspace";
import type { MarketplaceRfq } from "@/server/marketplace/types";

export const dynamic = "force-dynamic";

type PageParams = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RfqWorkspacePage({
  params,
  searchParams,
}: PageParams) {
  const [{ id }, resolvedSearchParams] = await Promise.all([
    params,
    resolveSearchParams(searchParams),
  ]);

  const viewerRole = deriveViewerRole(
    resolvedSearchParams?.viewer ?? resolvedSearchParams?.role ?? null,
  );

  const workspace = await loadRfqWorkspace(id, { viewerRole });

  if (!workspace) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-6 text-center">
          <h1 className="text-xl font-semibold text-white">Workspace unavailable</h1>
          <p className="mt-2 text-sm text-slate-400">
            We couldn’t open this search request workspace. Double-check the link or ask the
            Zartman team for access.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="space-y-3 border-b border-slate-900 pb-6">
        <p className="text-xs uppercase tracking-[0.3em] text-emerald-300">
          Open search request workspace
        </p>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-white">
            {workspace.rfq.title ?? "Untitled search request"}
          </h1>
          <p className="text-sm text-slate-400">
            Collaborative room for customers, suppliers, and Zartman operations.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-slate-400">
          <span>
            Viewer role:{" "}
            <span className="font-semibold text-slate-100">
              {formatViewerRole(workspace.viewerRole)}
            </span>
          </span>
          <span>
            Search request status:{" "}
            <span className="font-semibold text-slate-100">
              {workspace.rfq.status}
            </span>
          </span>
          <span>
            Last refreshed:{" "}
            <span className="font-mono text-slate-200">
              {formatDateTime(workspace.lastRefreshed, { includeTime: true }) ?? "—"}
            </span>
          </span>
        </div>
      </header>

      <div className="mt-8 space-y-6">
        <RfqSummaryCard rfq={workspace.rfq} />
        <SupplierActivityFeed
          supplierBids={workspace.supplierBids}
          supplierBidError={workspace.supplierBidError}
        />
        <CollaborationPanel threads={workspace.collaborationThreads} />
        <FilesAndRevisions attachments={workspace.fileAttachments} />
      </div>
    </main>
  );
}

function RfqSummaryCard({ rfq }: { rfq: MarketplaceRfq }) {
  const dueDate = formatDateTime(rfq.target_date, { includeTime: false }) ?? "Not scheduled";
  const priority = formatPriority(rfq.priority);

  return (
    <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-5">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Search request summary
        </p>
        <p className="text-sm text-slate-300">
          Quick snapshot of scope, urgency, and current posture.
        </p>
      </header>

      <dl className="mt-4 grid gap-4 text-sm text-slate-100 md:grid-cols-2">
        <SummaryItem label="Status" value={rfq.status ?? "unknown"} />
        <SummaryItem label="Due date" value={dueDate} />
        <SummaryItem label="Priority" value={priority} />
        <SummaryItem label="Quantity" value={rfq.quantity ? `${rfq.quantity} units` : "Not provided"} />
      </dl>

      <div className="mt-4 rounded-xl border border-slate-900 bg-black/20 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Overview
        </p>
        <p className="mt-2 text-sm text-slate-200">
          {rfq.description ?? "No overview shared yet. Add context to help suppliers respond intentionally."}
        </p>
      </div>
    </section>
  );
}

type SupplierActivityFeedProps = {
  supplierBids: RfqWorkspaceData["supplierBids"];
  supplierBidError: RfqWorkspaceData["supplierBidError"];
};

function SupplierActivityFeed({
  supplierBids,
  supplierBidError,
}: SupplierActivityFeedProps) {
  return (
    <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Supplier activity
          </p>
          <p className="text-sm text-slate-300">
            Live bids and status changes aggregated for this search request.
          </p>
        </div>
        <span className="text-xs text-slate-500">
          {supplierBids.length} bid{supplierBids.length === 1 ? "" : "s"}
        </span>
      </header>

      {supplierBidError ? (
        <p className="mt-4 rounded-xl border border-dashed border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {supplierBidError}
        </p>
      ) : null}

      <div className="mt-4 space-y-3">
        {supplierBids.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-800 bg-black/20 px-3 py-4 text-sm text-slate-400">
            No supplier responses yet. Once bids arrive, we’ll note amounts, lead times, and decision history here.
          </p>
        ) : (
          supplierBids.map((bid) => (
            <article
              key={bid.id}
              className="rounded-2xl border border-slate-900 bg-slate-950/60 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">
                    {bid.supplier?.company_name ?? "Supplier"}
                  </p>
                  <p className="text-xs text-slate-400">
                    {bid.supplier?.primary_email ?? "email pending"}
                  </p>
                </div>
                <span className="rounded-full border border-slate-800 px-3 py-1 text-xs font-semibold text-slate-300">
                  {bid.status}
                </span>
              </div>

              <dl className="mt-3 grid gap-3 text-sm text-slate-100 sm:grid-cols-2">
                <SummaryItem label="Total price" value={formatCurrency(bid.price_total, bid.currency)} />
                <SummaryItem
                  label="Lead time"
                  value={
                    bid.lead_time_days
                      ? `${bid.lead_time_days} day${bid.lead_time_days === 1 ? "" : "s"}`
                      : "Pending"
                  }
                />
              </dl>

              {bid.notes ? (
                <p className="mt-3 text-sm text-slate-300">
                  {bid.notes}
                </p>
              ) : null}
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function CollaborationPanel({ threads }: { threads: RfqCollaborationThread[] }) {
  return (
    <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-5">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Collaboration panel
        </p>
        <p className="text-sm text-slate-300">
          Messages between customers, suppliers, and Zartman operations.
        </p>
      </header>

      {threads.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-slate-800 bg-black/20 px-3 py-4 text-sm text-slate-400">
          No conversation yet. The thread will populate once someone posts an update.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {threads.map((thread) => (
            <article
              key={thread.id}
              className="rounded-2xl border border-slate-900 bg-black/30 p-4"
            >
              <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">
                    {thread.label}
                  </p>
                  <p className="text-xs text-slate-400">
                    {thread.channel === "internal"
                      ? "Visible to Zartman only"
                      : thread.channel === "supplier"
                        ? "Shared with supplier partners"
                        : "Shared with everyone"}
                  </p>
                </div>
                <span className="text-xs text-slate-500">
                  {thread.totalMessages} message{thread.totalMessages === 1 ? "" : "s"}
                </span>
              </header>

              <ul className="mt-3 space-y-3">
                {thread.messages.map((message) => (
                  <li key={message.id} className="rounded-xl border border-slate-900/60 bg-slate-950/40 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                      <span className="font-semibold text-slate-200">
                        {message.authorName ?? formatViewerRole(message.authorRole)}
                      </span>
                      <span>{formatDateTime(message.createdAt, { includeTime: true }) ?? "—"}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-100 whitespace-pre-line">
                      {message.body}
                    </p>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function FilesAndRevisions({
  attachments,
}: {
  attachments: RfqWorkspaceData["fileAttachments"];
}) {
  return (
    <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-5">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Files & revisions
        </p>
        <p className="text-sm text-slate-300">
          Attachments and historical revisions tied to this search request.
        </p>
      </header>

      {attachments.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-slate-800 bg-black/20 px-3 py-4 text-sm text-slate-400">
          No files shared yet. Uploads will appear here once they’re linked to the search request.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {attachments.map((file) => (
            <li
              key={file.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-900 bg-slate-950/60 px-4 py-3 text-sm text-slate-100"
            >
              <div>
                <p className="font-semibold text-white">{file.fileName}</p>
                <p className="text-xs text-slate-400">
                  {file.versionLabel ?? "v1"} ·{" "}
                  {file.uploadedAt
                    ? formatDateTime(file.uploadedAt, { includeTime: false })
                    : "timestamp pending"}
                </p>
              </div>
              <span className="text-xs text-slate-500">
                {file.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SummaryItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-900 bg-black/20 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="text-sm text-slate-100">{value}</p>
    </div>
  );
}

async function resolveSearchParams<T>(
  input?: Promise<T> | T,
): Promise<T | undefined> {
  if (!input) {
    return undefined;
  }
  return await input;
}

function deriveViewerRole(value: unknown): RfqWorkspaceViewerRole {
  const normalized =
    typeof value === "string"
      ? value.trim().toLowerCase()
      : Array.isArray(value) && typeof value[0] === "string"
        ? value[0].trim().toLowerCase()
        : null;

  if (normalized === "supplier" || normalized === "zartman") {
    return normalized;
  }
  return "customer";
}

function formatViewerRole(role: string): string {
  if (role === "zartman") {
    return "Zartman";
  }
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function formatPriority(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "Not set";
  }

  if (value >= 0.7) {
    return "High";
  }
  if (value >= 0.4) {
    return "Medium";
  }
  return "Standard";
}

function formatCurrency(
  amount: number | string | null,
  currency: string | null | undefined,
): string {
  if (amount === null || amount === undefined) {
    return "Pending";
  }

  const numeric =
    typeof amount === "string" ? Number.parseFloat(amount) : amount;

  if (!Number.isFinite(numeric)) {
    return "Pending";
  }

  const code = (currency ?? "USD").toUpperCase();

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 0,
    }).format(numeric);
  } catch {
    return `${code} ${numeric.toFixed(0)}`;
  }
}
