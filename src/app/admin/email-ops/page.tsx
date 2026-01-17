import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";
import AdminDashboardShell from "@/app/admin/AdminDashboardShell";
import { formatDateTime } from "@/lib/formatDate";
import {
  loadEmailOpsConfigSummary,
  loadEmailOpsCounters,
  loadEmailOpsRecentActivity,
  type EmailOpsActivityRow,
} from "@/server/admin/emailOps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pillClasses(tone: "on" | "off" | "warn"): string {
  if (tone === "on") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
  if (tone === "warn") return "border-amber-500/30 bg-amber-500/10 text-amber-100";
  return "border-slate-800/80 bg-slate-950/30 text-slate-400";
}

function Pill({
  tone,
  children,
  title,
}: {
  tone: "on" | "off" | "warn";
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={clsx("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold", pillClasses(tone))}
    >
      {children}
    </span>
  );
}

function formatEnvTriState(value: boolean | null): { label: string; tone: "on" | "off" | "warn" } {
  if (value === true) return { label: "true", tone: "on" };
  if (value === false) return { label: "false", tone: "off" };
  return { label: "unset", tone: "warn" };
}

function ActivityRow({ row }: { row: EmailOpsActivityRow }) {
  const when = formatDateTime(row.createdAt, { includeTime: true }) ?? row.createdAt;
  const directionTone = row.direction === "outbound" ? "on" : "off";
  const attachmentsTone = row.attachmentsCount > 0 ? "on" : "off";
  return (
    <div className="grid grid-cols-[170px_minmax(0,1fr)_110px_130px_140px] gap-3 px-6 py-4">
      <div className="text-sm text-slate-200">{when}</div>
      <div className="min-w-0">
        <Link
          href={`/admin/quotes/${encodeURIComponent(row.quoteId)}#messages`}
          className="truncate text-sm font-semibold text-emerald-200 underline-offset-4 hover:underline"
          title={row.quoteId}
        >
          {row.quoteId}
        </Link>
      </div>
      <div>
        <Pill tone={directionTone}>{row.direction}</Pill>
      </div>
      <div className="text-sm text-slate-200">{row.actorRole || "unknown"}</div>
      <div className="flex items-center gap-2">
        <Pill tone={attachmentsTone}>{row.attachmentsCount}</Pill>
        <span className="text-xs text-slate-500">attachments</span>
      </div>
    </div>
  );
}

export default async function AdminEmailOpsPage() {
  const [config, activity, counters] = await Promise.all([
    loadEmailOpsConfigSummary(),
    loadEmailOpsRecentActivity(),
    loadEmailOpsCounters(),
  ]);

  const outboundOn = config.outbound.status.enabled && config.outbound.emailOutboundEnabledEffective;
  const inboundOn = config.inbound.emailInboundEnabled;
  const portalSendOn =
    config.portalSendViaEmail.portalEmailSendEnabledEffective && config.outbound.status.enabled;
  const customerBridgeOn = config.customerEmailBridge.enabledEnv;
  const mismatchLogsOn = config.supplierMismatchLogs.enabledEnv;

  const outboundEnv = formatEnvTriState(config.outbound.emailOutboundEnabledEnv);
  const inboundEnv = formatEnvTriState(config.inbound.emailInboundEnabledEnv);
  const portalEnv = formatEnvTriState(config.portalSendViaEmail.portalEmailSendEnabledEnv);

  return (
    <AdminDashboardShell
      eyebrow="Admin"
      title="Email ops"
      description="Operational status + env-driven kill-switches (PII-safe)."
      actions={
        <Link
          href="/admin/email-ops"
          className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:border-slate-700 hover:bg-slate-900/30"
        >
          Refresh
        </Link>
      }
    >
      <div className="space-y-6">
        <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Configuration summary</h2>
              <p className="mt-1 text-sm text-slate-400">
                Read-only. Change these via environment variables and redeploy.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Pill tone={outboundOn ? "on" : "off"}>Outbound {outboundOn ? "ON" : "OFF"}</Pill>
              <Pill tone={inboundOn ? "on" : "off"}>Inbound {inboundOn ? "ON" : "OFF"}</Pill>
              <Pill tone={portalSendOn ? "on" : "off"}>Portal send {portalSendOn ? "ON" : "OFF"}</Pill>
            </div>
          </div>

          <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
            <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-4 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Outbound email
              </dt>
              <dd className="mt-2 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-slate-300">EMAIL_OUTBOUND_ENABLED</span>
                  <Pill tone={outboundEnv.tone}>{outboundEnv.label}</Pill>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-slate-300">Provider config</span>
                  <Pill tone={config.outbound.status.enabled ? "on" : config.outbound.emailOutboundEnabledEffective ? "warn" : "off"}>
                    {config.outbound.status.enabled ? "ok" : config.outbound.status.reason}
                  </Pill>
                </div>
              </dd>
            </div>

            <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-4 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Inbound email
              </dt>
              <dd className="mt-2 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-slate-300">EMAIL_INBOUND_ENABLED</span>
                  <Pill tone={inboundEnv.tone} title="Unset defaults to enabled only when Postmark basic auth is configured.">
                    {inboundEnv.label}
                  </Pill>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-slate-300">Postmark inbound basic auth</span>
                  <Pill tone={config.inbound.postmarkBasicAuthConfigured ? "on" : "off"}>
                    {config.inbound.postmarkBasicAuthConfigured ? "configured" : "missing"}
                  </Pill>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Endpoints</p>
                  <div className="space-y-1 text-xs text-slate-300">
                    {config.inbound.endpoints.map((ep) => (
                      <div key={ep.path} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-slate-200">{ep.path}</span>
                        <div className="flex items-center gap-2">
                          <Pill tone={ep.enabled ? "on" : "off"}>{ep.enabled ? "live" : "disabled"}</Pill>
                        </div>
                        {ep.note ? <p className="w-full text-[11px] text-slate-500">{ep.note}</p> : null}
                      </div>
                    ))}
                  </div>
                </div>
              </dd>
            </div>

            <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-4 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Customer email bridge (replies opt-in)
              </dt>
              <dd className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-slate-300">CUSTOMER_EMAIL_BRIDGE_ENABLED</span>
                <Pill tone={customerBridgeOn ? "on" : "off"}>{customerBridgeOn ? "true" : "false"}</Pill>
              </dd>
            </div>

            <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-4 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Portal send-via-email
              </dt>
              <dd className="mt-2 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-slate-300">PORTAL_EMAIL_SEND_ENABLED</span>
                  <Pill tone={portalEnv.tone}>{portalEnv.label}</Pill>
                </div>
                <p className="text-xs text-slate-500">
                  Effective only when outbound is ON.
                </p>
              </dd>
            </div>

            <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-4 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Supplier mismatch logs
              </dt>
              <dd className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-slate-300">SUPPLIER_MISMATCH_LOGS_ENABLED</span>
                <Pill tone={mismatchLogsOn ? "on" : "off"}>{mismatchLogsOn ? "true" : "false"}</Pill>
              </dd>
            </div>

            <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-4 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Attachments
              </dt>
              <dd className="mt-2 space-y-1 text-sm text-slate-300">
                <p>
                  Best-effort (storage bucket <span className="font-mono text-[11px] text-slate-200">{config.attachments.bucket}</span>).
                </p>
                <p className="text-xs text-slate-500">
                  We avoid expensive runtime checks here; attachment ingest may degrade gracefully if storage is unavailable.
                </p>
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-6">
          <h2 className="text-lg font-semibold text-white">Kill-switches (effective)</h2>
          <p className="mt-1 text-sm text-slate-400">
            These are env-driven only (no DB writes). Status reflects the current server evaluation.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <KillSwitchRow label="Inbound processing" on={inboundOn} detail="Affects /api/inbound/postmark and /api/inbound/email (no token parsing / no DB calls when OFF)." />
            <KillSwitchRow label="Outbound sending" on={outboundOn} detail="Gates all Postmark adapter sends (admin + invites + portal)." />
            <KillSwitchRow label="Portal send-via-email" on={portalSendOn} detail="Requires PORTAL_EMAIL_SEND_ENABLED=true and outbound ON." />
            <KillSwitchRow label="Customer email replies (opt-in system)" on={customerBridgeOn} detail="Gates customer reply ingestion + supplier→customer portal email policy checks." />
            <KillSwitchRow label="Supplier mismatch logs" on={mismatchLogsOn} detail="Controls mismatch logging/summary surfaces (existing feature)." />
          </div>
        </section>

        <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Recent activity</h2>
              <p className="mt-1 text-sm text-slate-400">
                Last 50 messages stored with <span className="font-mono text-[11px] text-slate-300">metadata.via</span> indicating email. No message bodies or email addresses are shown.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {counters.supported ? (
                <>
                  <Pill tone="warn">
                    {counters.isLowerBound ? "≥" : ""}
                    {counters.inbound} inbound (24h)
                  </Pill>
                  <Pill tone="warn">
                    {counters.isLowerBound ? "≥" : ""}
                    {counters.outbound} outbound (24h)
                  </Pill>
                  <Pill tone="warn">
                    {counters.isLowerBound ? "≥" : ""}
                    {counters.withAttachments} w/ attachments (24h)
                  </Pill>
                </>
              ) : (
                <Pill tone="off">Counters unsupported</Pill>
              )}
            </div>
          </div>

          {activity.ok && activity.supported ? (
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-900/60 bg-slate-950/30">
              <div className="grid grid-cols-[170px_minmax(0,1fr)_110px_130px_140px] gap-3 border-b border-slate-900/60 px-6 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <div>Created</div>
                <div>Quote</div>
                <div>Direction</div>
                <div>Actor</div>
                <div>Attachments</div>
              </div>
              <div className="divide-y divide-slate-900/60">
                {activity.rows.length > 0 ? (
                  activity.rows.map((row, idx) => <ActivityRow key={`${row.quoteId}-${row.createdAt}-${idx}`} row={row} />)
                ) : (
                  <div className="px-6 py-6 text-sm text-slate-400">No recent email messages found.</div>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-slate-900/60 bg-slate-950/30 p-5">
              <p className="text-sm text-slate-200">Recent activity is unavailable on this schema.</p>
              <p className="mt-1 text-sm text-slate-500">
                This page requires <span className="font-mono text-[11px] text-slate-300">quote_messages.metadata</span> to be present.
              </p>
            </div>
          )}
        </section>
      </div>
    </AdminDashboardShell>
  );
}

function KillSwitchRow({ label, on, detail }: { label: string; on: boolean; detail: string }) {
  return (
    <div className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-100">{label}</p>
          <p className="mt-1 text-xs text-slate-500">{detail}</p>
        </div>
        <Pill tone={on ? "on" : "off"}>{on ? "ON" : "OFF"}</Pill>
      </div>
    </div>
  );
}

