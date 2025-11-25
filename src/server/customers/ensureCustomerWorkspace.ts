import { createServerSupabaseClient } from "@/server/supabase";

export async function ensureCustomerWorkspaceForUser({
  userId,
  email,
  name,
  company,
}: {
  userId: string;
  email: string | null;
  name?: string | null;
  company?: string | null;
}) {
  if (!userId || !email) return false;

  const supabase = createServerSupabaseClient();

  const { data: existing } = await supabase
    .from("customers")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) return false;

  const { error } = await supabase.from("customers").insert({
    user_id: userId,
    email,
    name,
    company_name: company,
  });

  return !error;
}
