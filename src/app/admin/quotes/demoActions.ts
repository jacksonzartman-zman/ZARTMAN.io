"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdminUser } from "@/server/auth";
import { assertDemoModeEnabled } from "@/server/demo/demoMode";
import { seedDemoSearchRequest } from "@/server/demo/seedDemoSearchRequest";

export async function createDemoSearchRequestAction(): Promise<void> {
  const gitSha = process.env.VERCEL_GIT_COMMIT_SHA || "";
  const vercelEnv = process.env.VERCEL_ENV || "";
  console.error(
    `[demo seed] handler start fn=createDemoSearchRequestAction gitSha=${gitSha || "unknown"} vercelEnv=${vercelEnv || "unknown"}`,
  );

  const admin = await requireAdminUser();
  assertDemoModeEnabled();

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

