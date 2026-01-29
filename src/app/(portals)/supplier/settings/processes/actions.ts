"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import {
  listSupplierCapabilities,
  loadSupplierProfileByUserId,
  upsertSupplierCapabilities,
} from "@/server/suppliers/profile";

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

function normalizeProcessKey(value: string): string {
  return value.trim().toLowerCase();
}

export async function submitSupplierProcessesSettingsAction(formData: FormData) {
  const user = await requireUser({ redirectTo: "/supplier/settings/processes" });

  const profile = await loadSupplierProfileByUserId(user.id);
  const supplierId = profile?.supplier?.id ?? null;
  if (!supplierId) {
    redirect("/supplier/onboarding");
  }

  const selected = formData
    .getAll("processes")
    .map((value) => normalizeText(value))
    .filter((value) => value.length > 0);

  const uniqueByKey = new Map<string, string>();
  for (const process of selected) {
    const key = normalizeProcessKey(process);
    if (!key) continue;
    if (!uniqueByKey.has(key)) uniqueByKey.set(key, process);
  }

  const selectedKeys = new Set(Array.from(uniqueByKey.keys()));
  if (selectedKeys.size === 0) {
    redirect(
      "/supplier/settings/processes?error=Select%20at%20least%20one%20process%20before%20saving.",
    );
  }

  const existing = await listSupplierCapabilities(supplierId);
  const preserved = existing.filter((capability) =>
    selectedKeys.has(normalizeProcessKey(capability.process ?? "")),
  );

  const existingKeys = new Set(
    preserved.map((capability) => normalizeProcessKey(capability.process ?? "")),
  );

  const nextCapabilities = [
    ...preserved.map((capability) => ({
      process: capability.process,
      materials: capability.materials ?? [],
      certifications: capability.certifications ?? [],
      maxPartSize: (capability.max_part_size as any) ?? null,
    })),
    ...Array.from(uniqueByKey.entries())
      .filter(([key]) => !existingKeys.has(key))
      .map(([, label]) => ({
        process: label,
        materials: [],
        certifications: [],
        maxPartSize: null,
      })),
  ];

  await upsertSupplierCapabilities(supplierId, nextCapabilities);

  revalidatePath("/supplier");
  revalidatePath("/supplier/settings");
  revalidatePath("/supplier/settings/processes");

  redirect("/supplier/settings/processes?saved=1");
}

