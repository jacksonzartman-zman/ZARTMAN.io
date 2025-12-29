import { NextResponse } from "next/server";
import { getServerAuthUser, requireAdminUser } from "@/server/auth";

export const dynamic = "force-dynamic";

function safeHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

export async function GET() {
  const { user } = await getServerAuthUser();
  if (!user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    await requireAdminUser();
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Keep output production-safe: hostnames + presence booleans only (no secrets).
  const functionName = "step-to-stl" as const;

  const envSupabaseUrl = process.env.SUPABASE_URL ?? null;
  const envNextPublicSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
  const envFunctionsUrl = process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL ?? null;

  // This matches `src/lib/supabaseServer.ts` selection logic.
  const effectiveSupabaseUrl = envSupabaseUrl ?? envNextPublicSupabaseUrl ?? null;

  const supabaseHostFromSUPABASE_URL = safeHost(envSupabaseUrl);
  const supabaseHostEffective = safeHost(effectiveSupabaseUrl);
  const edgeUrl =
    effectiveSupabaseUrl
      ? `${effectiveSupabaseUrl.replace(/\/+$/, "")}/functions/v1/${functionName}`
      : null;

  return NextResponse.json(
    {
      ok: true,
      functionName,
      supabaseHost: supabaseHostFromSUPABASE_URL,
      supabaseHostEffective,
      edgeUrl,
      env: {
        hasSUPABASE_URL: Boolean(envSupabaseUrl),
        hasNEXT_PUBLIC_SUPABASE_URL: Boolean(envNextPublicSupabaseUrl),
        hasNEXT_PUBLIC_SUPABASE_FUNCTIONS_URL: Boolean(envFunctionsUrl),
        hasNEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
        hasSUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      },
      functionsInvoke: {
        client: "supabaseServer",
        implementation: "src/lib/supabaseServer.ts",
        keyType: "service_role",
      },
    },
    { status: 200 },
  );
}

