import { redirect } from "next/navigation";
import { getServerAuthUser } from "@/server/auth";

const DEFAULT_NEXT_PATH = "/customer";

export async function requireCustomerSessionOrRedirect(nextPath: string) {
  const resolvedNext = nextPath.trim() || DEFAULT_NEXT_PATH;
  const { user } = await getServerAuthUser({ quiet: true });
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(resolvedNext)}`);
  }
  return user;
}
