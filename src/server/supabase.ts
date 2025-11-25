import { supabaseAdmin } from "@/lib/supabaseServer";

export function createServerSupabaseClient() {
  return supabaseAdmin();
}
