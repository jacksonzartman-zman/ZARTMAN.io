import { createClient } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[backfill] missing env: ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  // Minimal smoke setup (no DB calls yet)
  createClient(url, serviceKey, { auth: { persistSession: false } });

  console.log("backfill script loaded");
}

main().catch((err) => {
  console.error("[backfill] fatal", err);
  process.exit(1);
});
