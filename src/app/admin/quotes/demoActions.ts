"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdminUser } from "@/server/auth";
import { assertDemoModeEnabled } from "@/server/demo/demoMode";
import { seedDemoSearchRequest } from "@/server/demo/seedDemoSearchRequest";
import { debugOnce } from "@/server/db/schemaErrors";
import { supabaseServer } from "@/lib/supabaseServer";
import { schemaGate } from "@/server/db/schemaContract";
import { isMissingTableOrColumnError, serializeSupabaseError } from "@/server/admin/logging";
import { awardOfferActionImpl } from "@/app/(portals)/customer/quotes/[id]/actions";

export async function createDemoSearchRequestAction(): Promise<void> {
  const gitSha = process.env.VERCEL_GIT_COMMIT_SHA || "";
  const vercelEnv = process.env.VERCEL_ENV || "";

  const admin = await requireAdminUser();
  assertDemoModeEnabled();

  debugOnce("demo_seed:create_demo_search_request_action", "[demo seed] createDemoSearchRequestAction invoked", {
    gitSha: gitSha || "unknown",
    vercelEnv: vercelEnv || "unknown",
    adminUserId: admin.id,
  });

  const result = await seedDemoSearchRequest({
    adminUserId: admin.id,
    adminEmail: admin.email ?? null,
  });

  if (!result.ok) {
    revalidatePath("/admin/quotes");
    redirect("/admin/quotes?demoSeed=error");
  }

  redirect(`/customer/search?quote=${result.quoteId}&demo=1`);
}

function getFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function normalizeReturnTo(value: string): string {
  if (!value) return "/admin/quotes";
  // Only allow redirecting back into the admin quotes list.
  return value.startsWith("/admin/quotes") ? value : "/admin/quotes";
}

function assertNotProduction(): void {
  if ((process.env.VERCEL_ENV ?? "").trim().toLowerCase() === "production") {
    notFound();
  }
}

export async function awardCheapestOfferAction(formData: FormData): Promise<void> {
  assertNotProduction();
  const admin = await requireAdminUser();
  assertDemoModeEnabled();

  const quoteId = getFormString(formData, "quoteId");
  const returnTo = normalizeReturnTo(getFormString(formData, "returnTo"));
  if (!quoteId) {
    redirect(returnTo);
  }

  const schemaReady = await schemaGate({
    enabled: true,
    relation: "rfq_offers",
    requiredColumns: ["id", "rfq_id", "total_price", "status"],
    warnPrefix: "[admin quotes demo]",
    warnKey: "admin_quotes_demo:award_cheapest_schema",
  });
  if (!schemaReady) {
    redirect(returnTo);
  }

  type OfferRow = {
    id: string;
    total_price: number | string | null;
    status: string | null;
  };

  let offerIdToAward: string | null = null;
  try {
    // Pull a small batch ordered by total_price and pick the best numeric value.
    const { data, error } = await supabaseServer()
      .from("rfq_offers")
      .select("id,total_price,status")
      .eq("rfq_id", quoteId)
      .in("status", ["received", "revised", "quoted"])
      .order("total_price", { ascending: true, nullsFirst: false })
      .limit(10)
      .returns<OfferRow[]>();

    if (error) {
      if (!isMissingTableOrColumnError(error)) {
        debugOnce("admin_quotes_demo:award_cheapest_query_failed", "[admin quotes demo] award cheapest query failed", {
          quoteId,
          error: serializeSupabaseError(error) ?? error,
        });
      }
      redirect(returnTo);
    }

    const rows = Array.isArray(data) ? data : [];
    const candidates = rows
      .map((row) => {
        const id = typeof row?.id === "string" ? row.id.trim() : "";
        const status = typeof row?.status === "string" ? row.status.trim().toLowerCase() : "";
        if (!id) return null;
        if (status === "withdrawn") return null;
        const raw = row?.total_price;
        const value =
          typeof raw === "number"
            ? raw
            : typeof raw === "string"
              ? Number(raw.trim())
              : Number.NaN;
        if (!Number.isFinite(value)) return null;
        return { id, value };
      })
      .filter((v): v is { id: string; value: number } => Boolean(v))
      .sort((a, b) => a.value - b.value);

    offerIdToAward = candidates[0]?.id ?? null;
  } catch (error) {
    debugOnce("admin_quotes_demo:award_cheapest_query_crashed", "[admin quotes demo] award cheapest query crashed", {
      quoteId,
      error: String(error),
    });
    redirect(returnTo);
  }

  if (!offerIdToAward) {
    redirect(returnTo);
  }

  const result = await awardOfferActionImpl(
    { rfqId: quoteId, offerId: offerIdToAward },
    {
      supabase: supabaseServer(),
      actor: { role: "admin", userId: admin.id },
    },
  );

  if (!result.ok) {
    debugOnce("admin_quotes_demo:award_cheapest_failed", "[admin quotes demo] award cheapest failed", {
      quoteId,
      offerId: offerIdToAward,
      error: result.error,
    });
    redirect(returnTo);
  }

  revalidatePath("/admin/quotes");
  revalidatePath(`/admin/quotes/${quoteId}`);
  revalidatePath(`/customer/quotes/${quoteId}`);
  revalidatePath(`/supplier/quotes/${quoteId}`);

  redirect(returnTo);
}

