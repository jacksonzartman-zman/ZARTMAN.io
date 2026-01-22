"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getFormString, serializeActionError } from "@/lib/forms";
import { requireAdminUser } from "@/server/auth";
import { createDiscoveredProviderStub } from "@/server/providers";
import { logSupplierDiscoveredOpsEvent } from "@/server/ops/events";

const DISCOVER_ERROR = "We couldn't create this supplier stub right now.";

export async function discoverSupplierAction(formData: FormData): Promise<void> {
  try {
    await requireAdminUser();

    const companyName = normalizeRequiredText(getFormString(formData, "company_name"));
    const website = normalizeRequiredText(getFormString(formData, "website"));
    const email = normalizeOptionalText(getFormString(formData, "email"));

    if (!companyName || !website) {
      redirect("/admin/suppliers/discover?error=missing");
    }

    const processes = normalizeTagInputs(formData.getAll("processes"));
    const materials = normalizeTagInputs(formData.getAll("materials"));

    const { providerId } = await createDiscoveredProviderStub({
      name: companyName,
      website,
      email,
      processes,
      materials,
    });

    await logSupplierDiscoveredOpsEvent({
      supplierName: companyName,
      website,
      email,
      providerId,
      processes,
      materials,
    });

    revalidatePath("/admin/providers");
    revalidatePath("/admin/providers/pipeline");
    revalidatePath("/admin/suppliers/discover");

    redirect(
      providerId
        ? `/admin/suppliers/discover?created=1&providerId=${encodeURIComponent(providerId)}`
        : "/admin/suppliers/discover?created=1",
    );
  } catch (error) {
    console.error("[admin suppliers discover] create stub crashed", {
      error: serializeActionError(error) ?? DISCOVER_ERROR,
    });
    redirect("/admin/suppliers/discover?error=1");
  }
}

function normalizeRequiredText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTagInputs(values: unknown[]): string[] {
  const normalized = values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0)
    .map((value) => value.toLowerCase());
  return Array.from(new Set(normalized));
}

