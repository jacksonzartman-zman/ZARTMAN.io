"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdminUser } from "@/server/auth";
import { assertDemoModeEnabled } from "@/server/demo/demoMode";
import { seedDemoSearchRequest } from "@/server/demo/seedDemoSearchRequest";

export async function createDemoSearchRequestAction(): Promise<void> {
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

