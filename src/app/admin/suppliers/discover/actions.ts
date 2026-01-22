"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getFormString, serializeActionError } from "@/lib/forms";
import { requireAdminUser } from "@/server/auth";
import { createDiscoveredProviderStub, updateDiscoveredProviderStub } from "@/server/providers";
import { logSupplierDiscoveredOpsEvent, logSupplierDiscoveryUpdatedOpsEvent } from "@/server/ops/events";

const DISCOVER_ERROR = "We couldn't create this supplier stub right now.";
const UPDATE_ERROR = "We couldn't update this supplier stub right now.";

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

export async function updateSupplierDiscoveryAction(formData: FormData): Promise<void> {
  try {
    await requireAdminUser();

    const providerId = normalizeRequiredText(getFormString(formData, "provider_id"));
    const companyName = normalizeRequiredText(getFormString(formData, "company_name"));
    const website = normalizeOptionalText(getFormString(formData, "website"));
    const email = normalizeOptionalText(getFormString(formData, "email"));
    const notes = normalizeOptionalText(getFormString(formData, "notes"));
    const country = normalizeOptionalText(getFormString(formData, "country"));
    const states = normalizeStates(getFormString(formData, "states"));

    if (!providerId || !companyName) {
      redirect("/admin/suppliers/discover?error=missing");
    }

    const processes = normalizeTagInputs(formData.getAll("processes"));
    if (processes.length === 0) {
      redirect(`/admin/suppliers/discover?editProviderId=${encodeURIComponent(providerId)}&error=missing`);
    }

    const materials = normalizeTagInputs(formData.getAll("materials"));

    const result = await updateDiscoveredProviderStub({
      providerId,
      name: companyName,
      website,
      email,
      processes,
      materials,
      notes,
      country,
      states,
    });

    if (!result.ok) {
      redirect(`/admin/suppliers/discover?editProviderId=${encodeURIComponent(providerId)}&error=1`);
    }

    await logSupplierDiscoveryUpdatedOpsEvent({
      supplierName: companyName,
      website,
      email,
      providerId,
      processes,
      materials,
      note: notes,
      country,
      states,
    });

    revalidatePath("/admin/providers");
    revalidatePath("/admin/providers/pipeline");
    revalidatePath("/admin/suppliers/discover");

    redirect(`/admin/suppliers/discover?editProviderId=${encodeURIComponent(providerId)}&updated=1`);
  } catch (error) {
    console.error("[admin suppliers discover] update stub crashed", {
      error: serializeActionError(error) ?? UPDATE_ERROR,
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

function normalizeStates(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const parts = value
    .split(",")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toUpperCase());
  return Array.from(new Set(parts));
}

