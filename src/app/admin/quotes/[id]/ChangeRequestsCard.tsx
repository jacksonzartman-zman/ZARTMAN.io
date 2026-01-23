import clsx from "clsx";
import Link from "next/link";
import { formatDateTime } from "@/lib/formatDate";
import { ctaSizeClasses, secondaryCtaClasses } from "@/lib/ctas";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import { supabaseServer } from "@/lib/supabaseServer";
import ResolveChangeRequestButton from "@/app/admin/change-requests/ResolveChangeRequestButton";
import { TagPill } from "@/components/shared/primitives/TagPill";

type QuoteChangeRequestRow = {
  id: string;
  quote_id: string;
  change_type: string;
  notes: string;
  created_at: string;
  created_by_user_id: string | null;
  created_by_role: string;
  status: string | null;
  resolved_at: string | null;
};

export type ChangeRequestsCardProps = {
  quoteId: string;
  messagesHref?: string;
};

function formatChangeTypeLabel(changeType: string | null | undefined): string {
  switch ((changeType ?? "").trim().toLowerCase()) {
    case "tolerance":
      return "Tolerance change";
    case "material_finish":
      return "Material / finish";
    case "lead_time":
      return "Lead time";
    case "shipping":
      return "Shipping / address";
    case "revision":
      return "Revision / updated files";
    default:
      return "Change request";
  }
}

export default async function ChangeRequestsCard({
  quoteId,
  messagesHref,
}: ChangeRequestsCardProps) {
  const fallbackMessagesHref = messagesHref ?? "#messages";
  const cardClasses = "rounded-2xl border border-slate-800 bg-slate-950/60 px-5 py-4";

  let rows: QuoteChangeRequestRow[] = [];
  let totalCount: number | null = null;
  let loadError: string | null = null;

  try {
    const result = await supabaseServer()
      .from("quote_change_requests")
      .select(
        "id,quote_id,change_type,notes,created_at,created_by_user_id,created_by_role,status,resolved_at",
        { count: "exact" },
      )
      .eq("quote_id", quoteId)
      .order("created_at", { ascending: false })
      .limit(25);

    if (result.error) {
      loadError = result.error.message;
      console.error("[admin change-requests] load failed", {
        quoteId,
        error: result.error,
      });
    } else {
      rows = (result.data ?? []) as QuoteChangeRequestRow[];
      totalCount = typeof result.count === "number" ? result.count : null;
    }
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Unknown error";
    console.error("[admin change-requests] load failed", { quoteId, error });
  }

  const countLabel = `${totalCount ?? rows.length} total`;

  return (
    <section id="change-requests" className={cardClasses} aria-label="Change requests">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h2 className="text-base font-semibold text-slate-100">Change requests</h2>
            <span className="text-xs text-slate-500">{countLabel}</span>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            Use Messages to coordinate clarifications and next steps.
          </p>
        </div>
        <Link
          href={fallbackMessagesHref}
          className={clsx(secondaryCtaClasses, ctaSizeClasses.sm, "whitespace-nowrap")}
        >
          Open messages
        </Link>
      </div>

      {loadError ? (
        <p className="mt-4 rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-4 py-3 text-sm text-yellow-100">
          Change requests unavailable.
        </p>
      ) : null}

      <div className="mt-4">
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-5 py-4">
            <p className="text-sm font-semibold text-slate-100">No change requests yet</p>
            <p className="mt-1 text-sm text-slate-400">
              Requests will appear here when a customer submits changes in the workspace.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-900/60 rounded-2xl border border-slate-900/60 bg-slate-950/30">
            {rows.map((row) => {
              const createdAtRelative =
                formatRelativeTimeFromTimestamp(toTimestamp(row.created_at)) ?? "—";
              const createdAtAbsolute = formatDateTime(row.created_at, {
                includeTime: true,
                fallback: "—",
              });

              const normalizedStatus = (row.status ?? "").trim().toLowerCase();
              const isOpen = normalizedStatus === "open";
              const isResolved = normalizedStatus === "resolved" || Boolean(row.resolved_at);
              const statusLabel = isOpen ? "Open" : isResolved ? "Resolved" : "—";
              const statusTone = isOpen ? "amber" : isResolved ? "emerald" : "muted";

              return (
                <li key={row.id} className="px-4 py-3">
                  <div className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)_minmax(0,170px)] gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-100">
                        {formatChangeTypeLabel(row.change_type)}
                      </p>
                    </div>

                    <div className="min-w-0">
                      <p
                        className="break-anywhere min-w-0 overflow-hidden text-ellipsis text-sm text-slate-200 [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
                        title={row.notes}
                      >
                        {row.notes}
                      </p>
                    </div>

                    <div className="min-w-0 text-right">
                      <p
                        className="whitespace-nowrap text-sm font-medium text-slate-200"
                        title={createdAtAbsolute}
                      >
                        {createdAtAbsolute}
                      </p>
                      <p className="whitespace-nowrap text-xs text-slate-500">
                        {createdAtRelative}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                        <TagPill tone={statusTone} className="shrink-0">
                          {statusLabel}
                        </TagPill>
                        {isOpen ? (
                          <ResolveChangeRequestButton
                            changeRequestId={row.id}
                            className="max-w-full"
                          />
                        ) : null}
                      </div>
                    </div>
                  </div>

                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

