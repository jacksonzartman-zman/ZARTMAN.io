import Link from "next/link";
import PortalCard from "@/app/(portals)/PortalCard";
import { PortalShell } from "@/app/(portals)/components/PortalShell";
import { requireUser } from "@/server/auth";
import { loadSupplierProfileByUserId } from "@/server/suppliers/profile";
import {
  buildSupplierInviteLink,
  listSupplierPendingInvites,
  listSupplierTeamMembers,
} from "@/server/suppliers/invites";
import { formatDateTime } from "@/lib/formatDate";
import { CopyInviteLinkButton } from "./CopyInviteLinkButton";
import {
  resendSupplierInviteAction,
  sendSupplierInviteAction,
} from "./actions";
import { ctaSizeClasses, primaryInfoCtaClasses } from "@/lib/ctas";

export const dynamic = "force-dynamic";

type SupplierTeamSettingsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SupplierTeamSettingsPage({
  searchParams,
}: SupplierTeamSettingsPageProps) {
  const user = await requireUser({ redirectTo: "/supplier/settings/team" });
  const profile = await loadSupplierProfileByUserId(user.id);
  const supplier = profile?.supplier ?? null;

  if (!supplier) {
    return (
      <PortalShell
        workspace="supplier"
        title="Team"
        subtitle="Invite teammates to collaborate in your supplier workspace."
        actions={
          <Link
            href="/supplier/settings"
            className="inline-flex items-center rounded-full border border-blue-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-blue-100 transition hover:border-blue-300 hover:text-white motion-reduce:transition-none"
          >
            Back to settings
          </Link>
        }
      >
        <PortalCard
          title="Finish onboarding"
          description="Complete onboarding before inviting teammates."
        >
          <Link
            href="/supplier/onboarding"
            className="text-sm font-semibold text-blue-200 underline-offset-4 hover:underline"
          >
            Complete onboarding
          </Link>
        </PortalCard>
      </PortalShell>
    );
  }

  const resolved = searchParams ? await searchParams : undefined;
  const sent = firstString(resolved?.sent);
  const resent = firstString(resolved?.resent);
  const error = firstString(resolved?.error);

  const [members, pendingInvites] = await Promise.all([
    listSupplierTeamMembers({
      supplierId: supplier.id,
      supplierOwnerUserId: supplier.user_id ?? null,
    }),
    listSupplierPendingInvites({ supplierId: supplier.id }),
  ]);

  return (
    <PortalShell
      workspace="supplier"
      title="Team"
      subtitle="Invite teammates to collaborate in your supplier workspace."
      actions={
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/supplier/settings"
            className="text-sm font-semibold text-blue-200 underline-offset-4 hover:underline"
          >
            Back to settings
          </Link>
          <Link
            href="/supplier"
            className="inline-flex items-center rounded-full border border-blue-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-blue-100 transition hover:border-blue-300 hover:text-white motion-reduce:transition-none"
          >
            Dashboard
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        {sent ? (
          <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            Invite sent to <span className="font-mono text-white">{sent}</span>.
          </p>
        ) : null}

        {resent ? (
          <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            Invite resent to <span className="font-mono text-white">{resent}</span>.
          </p>
        ) : null}

        {error ? (
          <p
            className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <PortalCard
          title="Invite teammate"
          description="We’ll email them a link to accept and join your workspace."
        >
          <form action={sendSupplierInviteAction} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                Email
              </span>
              <input
                name="email"
                type="email"
                required
                placeholder="teammate@company.com"
                className="w-full min-w-[18rem] rounded-xl bg-slate-950/35 px-3 py-2.5 text-sm text-slate-100 ring-1 ring-slate-800/50"
              />
            </label>
            <button
              type="submit"
              className="rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-white motion-reduce:transition-none"
            >
              Send invite
            </button>
          </form>
        </PortalCard>

        <PortalCard
          title="Team members"
          description="Active users who can access this supplier workspace."
        >
          <div className="overflow-x-auto">
            <table className="min-w-full table-fixed text-sm">
              <thead className="text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                <tr>
                  <th className="w-[20rem] py-2 pr-4">Email</th>
                  <th className="w-[10rem] py-2 pr-4">Role</th>
                  <th className="w-[10rem] py-2 pr-4">Status</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {members.length > 0 ? (
                  members.map((member) => (
                    <tr key={member.userId} className="border-t border-slate-800/50">
                      <td className="py-3 pr-4 font-mono text-xs text-slate-100">
                        {member.email ?? "unknown"}
                      </td>
                      <td className="py-3 pr-4">{member.roleLabel}</td>
                      <td className="py-3 pr-4">{member.statusLabel}</td>
                    </tr>
                  ))
                ) : (
                  <tr className="border-t border-slate-800/50">
                    <td className="py-3 pr-4 text-slate-400" colSpan={3}>
                      No team members found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </PortalCard>

        <PortalCard
          title="Pending invites"
          description="Invites that haven’t been accepted yet."
        >
          <div className="overflow-x-auto">
            <table className="min-w-full table-fixed text-sm">
              <thead className="text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                <tr>
                  <th className="w-[20rem] py-2 pr-4">Email</th>
                  <th className="w-[12rem] py-2 pr-4">Invited</th>
                  <th className="w-[18rem] py-2 pr-4 whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {pendingInvites.length > 0 ? (
                  pendingInvites.map((invite) => {
                    const link = buildSupplierInviteLink(invite.token);
                    const invitedAt = formatDateTime(invite.createdAt, {
                      includeTime: true,
                    });

                    return (
                      <tr key={invite.id} className="border-t border-slate-800/50">
                        <td className="py-3 pr-4 font-mono text-xs text-slate-100">
                          {invite.email}
                        </td>
                        <td className="py-3 pr-4 text-xs text-slate-400">
                          {invitedAt ?? invite.createdAt}
                        </td>
                        <td className="py-3 pr-4">
                          <div className="flex flex-wrap gap-2">
                            <form action={resendSupplierInviteAction}>
                              <input type="hidden" name="inviteId" value={invite.id} />
                              <button
                                type="submit"
                                className={`${primaryInfoCtaClasses} ${ctaSizeClasses.sm} text-xs font-semibold uppercase tracking-wide`}
                              >
                                Resend invite
                              </button>
                            </form>
                            <CopyInviteLinkButton link={link} />
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr className="border-t border-slate-800/50">
                    <td className="py-3 pr-4 text-slate-400" colSpan={3}>
                      No pending invites.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </PortalCard>
      </div>
    </PortalShell>
  );
}

function firstString(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : null;
  }
  return typeof value === "string" ? value : null;
}
