import Link from "next/link";
import { redirect } from "next/navigation";

import { getServerAuthUser } from "@/server/auth";
import { logOpsEventNoQuote } from "@/server/ops/events";
import { acceptCustomerTeamInvite, loadCustomerTeamInviteByToken } from "@/server/customerTeams/invites";

export const dynamic = "force-dynamic";

type CustomerTeamInvitePageProps = {
  params?: Promise<{ token?: string | string[] }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstString(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : Array.isArray(value) ? value[0] ?? "" : "";
}

function normalizeNextPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Only allow internal customer paths to avoid open redirects.
  if (!trimmed.startsWith("/customer")) return null;
  if (trimmed.startsWith("//")) return null;
  if (/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

async function CustomerTeamInvitePage({ params, searchParams }: CustomerTeamInvitePageProps) {
  const resolved = params ? await params : undefined;
  const token =
    typeof resolved?.token === "string"
      ? resolved.token
      : Array.isArray(resolved?.token)
        ? resolved.token[0]
        : "";

  const query = searchParams ? await searchParams : undefined;
  const nextPath = normalizeNextPath(firstString(query?.next));

  const invite = await loadCustomerTeamInviteByToken({ token });

  if (!invite || invite.status !== "pending") {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-4 py-12 text-center">
        <p className="text-lg font-semibold text-white">Invite link is invalid</p>
        <p className="text-sm text-slate-300">
          This invite link is expired or has already been used.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center justify-center rounded-full border border-slate-600 px-5 py-2 text-sm font-semibold text-slate-100 hover:border-slate-500"
        >
          Go to login
        </Link>
      </main>
    );
  }

  const { user } = await getServerAuthUser({ quiet: true });

  const selfPath = `/customer/team/invite/${encodeURIComponent(invite.token)}${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ""}`;

  if (!user) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-4 py-12 text-center">
        <p className="text-lg font-semibold text-white">Log in to accept invite</p>
        <p className="text-sm text-slate-300">
          Sign in as <span className="font-mono text-white">{invite.email}</span> to join this team.
        </p>
        <Link
          href={`/login?next=${encodeURIComponent(selfPath)}`}
          className="inline-flex items-center justify-center rounded-full bg-white/90 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-white"
        >
          Go to login
        </Link>
      </main>
    );
  }

  const accept = await acceptCustomerTeamInvite({
    token: invite.token,
    userId: user.id,
    userEmail: user.email ?? null,
  });

  if (!accept.ok) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-4 py-12 text-center">
        <p className="text-lg font-semibold text-white">Couldn’t accept invite</p>
        <p className="text-sm text-slate-300">{accept.error}</p>
        <Link
          href={`/login?next=${encodeURIComponent(selfPath)}`}
          className="inline-flex items-center justify-center rounded-full border border-slate-600 px-5 py-2 text-sm font-semibold text-slate-100 hover:border-slate-500"
        >
          Switch account
        </Link>
      </main>
    );
  }

  void logOpsEventNoQuote({
    eventType: "customer_team_invite_accepted",
    payload: {
      team_id: accept.teamId,
      user_id: user.id,
      user_email: user.email ?? undefined,
    },
  });

  redirect(nextPath ?? "/customer?invite=accepted");
}

type NextAppPage = (props: {
  params?: Promise<Record<string, unknown>>;
  searchParams?: Promise<any>;
}) => ReturnType<typeof CustomerTeamInvitePage>;

export default CustomerTeamInvitePage as unknown as NextAppPage;

