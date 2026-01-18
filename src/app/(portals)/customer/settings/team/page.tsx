import Link from "next/link";
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
      <div className="space-y-6">
        <section className="rounded-2xl border border-slate-900 bg-slate-950/70 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-300">
            Customer workspace
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-white">Team</h1>
          <p className="mt-2 text-sm text-slate-400">
            Complete your customer profile before inviting teammates.
          </p>
          <div className="mt-4">
            <Link
              href="/customer/settings"
              className="text-sm font-semibold text-emerald-300 underline-offset-4 hover:underline"
            >
              Go to settings
            </Link>
          </div>
        </section>
      </div>
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
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-900 bg-slate-950/70 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-300">
          Customer workspace
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-white">Team</h1>
        <p className="mt-2 text-sm text-slate-400">
          Invite teammates to collaborate in your customer portal.
        </p>
      </section>

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

      <section className="rounded-2xl border border-slate-900 bg-slate-950/70 p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Invite teammate</h2>
          <p className="mt-1 text-sm text-slate-400">
            We’ll email them a link to accept and join your workspace.
          </p>
        </div>

        <form action={sendCustomerInviteAction} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Email
            </span>
            <input
              name="email"
              type="email"
              required
              placeholder="teammate@company.com"
              className="w-full min-w-[18rem] rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-white"
            />
          </label>
          <button
            type="submit"
            className="rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-white"
          >
            Send invite
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-900 bg-slate-950/70 p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Team members</h2>
          <p className="mt-1 text-sm text-slate-400">
            Active users who can access this customer workspace.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">Status</th>
              </tr>
            </thead>
            <tbody className="text-slate-200">
              {members.length > 0 ? (
                members.map((member) => (
                  <tr key={member.userId} className="border-t border-slate-900/70">
                    <td className="py-3 pr-4 font-mono text-xs text-slate-100">
                      {member.email ?? "unknown"}
                    </td>
                    <td className="py-3 pr-4">{member.roleLabel}</td>
                    <td className="py-3 pr-4">{member.statusLabel}</td>
                  </tr>
                ))
              ) : (
                <tr className="border-t border-slate-900/70">
                  <td className="py-3 pr-4 text-slate-400" colSpan={3}>
                    No team members found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-900 bg-slate-950/70 p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Pending invites</h2>
          <p className="mt-1 text-sm text-slate-400">
            Invites that haven’t been accepted yet.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
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
                    <tr key={invite.id} className="border-t border-slate-900/70">
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
                              className="rounded-full border border-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-slate-700 hover:text-white"
                            >
                              Resend
                            </button>
                          </form>
                          <CopyInviteLinkButton link={link} />
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr className="border-t border-slate-900/70">
                  <td className="py-3 pr-4 text-slate-400" colSpan={3}>
                    No pending invites.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function firstString(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : null;
  }
  return typeof value === "string" ? value : null;
}

