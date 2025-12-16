import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerAuthUser } from "@/server/auth";
import { loadSupplierById } from "@/server/suppliers/profile";
import {
  acceptSupplierInvite,
  loadSupplierInviteByToken,
} from "@/server/suppliers/invites";

export const dynamic = "force-dynamic";

type SupplierInvitePageProps = {
  params?: Promise<{ token?: string | string[] }>;
};

async function SupplierInvitePage({ params }: SupplierInvitePageProps) {
  const resolved = params ? await params : undefined;
  const token =
    typeof resolved?.token === "string"
      ? resolved.token
      : Array.isArray(resolved?.token)
        ? resolved.token[0]
        : "";

  const invite = await loadSupplierInviteByToken({ token });

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

  const { user } = await getServerAuthUser();

  if (!user) {
    const nextPath = `/supplier/invite/${encodeURIComponent(invite.token)}`;
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-4 py-12 text-center">
        <p className="text-lg font-semibold text-white">Log in to accept invite</p>
        <p className="text-sm text-slate-300">
          Sign in as <span className="font-mono text-white">{invite.email}</span> to join this supplier workspace.
        </p>
        <Link
          href={`/login?next=${encodeURIComponent(nextPath)}`}
          className="inline-flex items-center justify-center rounded-full bg-white/90 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-white"
        >
          Go to login
        </Link>
      </main>
    );
  }

  const accept = await acceptSupplierInvite({
    token: invite.token,
    userId: user.id,
    userEmail: user.email ?? null,
  });

  if (!accept.ok) {
    const supplier = await loadSupplierById(invite.supplier_id);
    const companyName = supplier?.company_name ?? "this supplier workspace";

    return (
      <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-4 py-12 text-center">
        <p className="text-lg font-semibold text-white">Couldn’t accept invite</p>
        <p className="text-sm text-slate-300">{accept.error}</p>
        <p className="text-xs text-slate-500">
          Invite for <span className="font-semibold text-slate-200">{companyName}</span>.
        </p>
        <Link
          href={`/login?next=${encodeURIComponent(`/supplier/invite/${encodeURIComponent(invite.token)}`)}`}
          className="inline-flex items-center justify-center rounded-full border border-slate-600 px-5 py-2 text-sm font-semibold text-slate-100 hover:border-slate-500"
        >
          Switch account
        </Link>
      </main>
    );
  }

  redirect("/supplier?invite=accepted");
}

type NextAppPage = (props: {
  params?: Promise<Record<string, unknown>>;
  searchParams?: Promise<any>;
}) => ReturnType<typeof SupplierInvitePage>;

export default SupplierInvitePage as unknown as NextAppPage;
