import Link from "next/link";
import PortalCard from "@/app/(portals)/PortalCard";
import { PortalShell } from "@/app/(portals)/components/PortalShell";
import { requireCustomerSessionOrRedirect } from "@/app/(portals)/customer/requireCustomerSessionOrRedirect";
import { getCustomerByUserId } from "@/server/customers";
import {
  buildCustomerInviteLink,
  listCustomerPendingInvites,
  listCustomerTeamMembers,
} from "@/server/customers/invites";
import { formatDateTime } from "@/lib/formatDate";
import { CopyInviteLinkButton } from "./CopyInviteLinkButton";
import { resendCustomerInviteAction, sendCustomerInviteAction } from "./actions";
import { ctaSizeClasses, primaryCtaClasses } from "@/lib/ctas";

export const dynamic = "force-dynamic";

type CustomerTeamSettingsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CustomerTeamSettingsPage({
  searchParams,
}: CustomerTeamSettingsPageProps) {
  const user = await requireCustomerSessionOrRedirect("/customer/settings/team");
  const customer = await getCustomerByUserId(user.id);

  if (!customer) {
    return (
      <PortalShell
        workspace="customer"
        title="Team"
        subtitle="Invite teammates to collaborate in your customer workspace."
        actions={
          <Link
            href="/customer/settings"
            className="inline-flex items-center rounded-full border border-emerald-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 transition hover:border-emerald-300 hover:text-white"
          >
            Back to settings
          </Link>
        }
      >
        <PortalCard
          title="Finish setup"
          description="Complete your customer profile before inviting teammates."
        >
          <Link
            href="/customer/settings"
            className="text-sm font-semibold text-emerald-300 underline-offset-4 hover:underline"
          >
            Go to settings
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
    listCustomerTeamMembers({
      customerId: customer.id,
      customerOwnerUserId: customer.user_id ?? null,
    }),
    listCustomerPendingInvites({ customerId: customer.id }),
  ]);

  return (
    <PortalShell
      workspace="customer"
      title="Team"
      subtitle="Invite teammates to collaborate in your customer workspace."
      actions={
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/customer/settings"
            className="text-sm font-semibold text-emerald-300 underline-offset-4 hover:underline"
          >
            Back to settings
          </Link>
          <Link
            href="/customer"
            className="inline-flex items-center rounded-full border border-emerald-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 transition hover:border-emerald-300 hover:text-white"
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
          <form action={sendCustomerInviteAction} className="flex flex-wrap items-end gap-3">
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
              className="rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-white"
            >
              Send invite
            </button>
          </form>
        </PortalCard>

        <PortalCard
          title="Team members"
          description="Active users who can access this customer workspace."
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                <tr>
                  <th className="py-2 pr-4">Email</th>
                  <th className="py-2 pr-4">Role</th>
                  <th className="py-2 pr-4">Status</th>
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
            <table className="min-w-full text-sm">
              <thead className="text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                <tr>
                  <th className="py-2 pr-4">Email</th>
                  <th className="py-2 pr-4">Invited</th>
                  <th className="py-2 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {pendingInvites.length > 0 ? (
                  pendingInvites.map((invite) => {
                    const link = buildCustomerInviteLink(invite.token);
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
                            <form action={resendCustomerInviteAction}>
                              <input type="hidden" name="inviteId" value={invite.id} />
                              <button
                                type="submit"
                                className={`${primaryCtaClasses} ${ctaSizeClasses.sm} text-xs font-semibold uppercase tracking-wide`}
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

