"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  addSupplierDocument,
  upsertSupplierProfile,
  type SupplierCapabilityInput,
} from "@/server/suppliers";

export type SupplierOnboardingState = {
  success: boolean;
  error: string | null;
  fieldErrors?: Record<string, string>;
};

const SUPPLIER_DOCS_BUCKET =
  process.env.SUPPLIER_DOCS_BUCKET ||
  process.env.NEXT_PUBLIC_SUPPLIER_DOCS_BUCKET ||
  "supplier-docs";

const MAX_DOCUMENTS = 5;

export async function submitSupplierOnboardingAction(
  _prevState: SupplierOnboardingState,
  formData: FormData,
): Promise<SupplierOnboardingState> {
  const companyName = getText(formData, "company_name");
  const primaryEmail = normalizeEmail(getText(formData, "primary_email"));
  const phone = getText(formData, "phone");
  const website = getText(formData, "website");
  const country = getText(formData, "country");
  const capabilitiesPayload = getText(formData, "capabilities_payload");
  const documentCount = Number(formData.get("document_count") ?? 0);

  const fieldErrors: Record<string, string> = {};

  if (!companyName) {
    fieldErrors.company_name = "Enter your company name.";
  }

  if (!primaryEmail) {
    fieldErrors.primary_email = "Enter a valid primary email.";
  }

  if (documentCount > MAX_DOCUMENTS) {
    fieldErrors.documents = `Limit uploads to ${MAX_DOCUMENTS} files.`;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { success: false, error: "Check the highlighted fields.", fieldErrors };
  }

  const capabilities = parseCapabilities(capabilitiesPayload);

  try {
    const profile = await upsertSupplierProfile({
      primaryEmail,
      companyName: companyName!,
      phone,
      website,
      country,
      capabilities,
    });

    if (!profile?.supplier) {
      return {
        success: false,
        error: "Unable to save your profile. Please try again.",
      };
    }

    await handleDocumentUploads(profile.supplier.id, formData, documentCount);

    revalidatePath("/supplier");
    redirect(`/supplier?email=${encodeURIComponent(primaryEmail)}&onboard=1`);
  } catch (error) {
    console.error("submitSupplierOnboardingAction: unexpected failure", error);
    return {
      success: false,
      error: "We couldn’t save your profile. Please try again.",
    };
  }

}

function getText(formData: FormData, key: string): string | null {
  const raw = formData.get(key);
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEmail(value?: string | null): string {
  return value?.toLowerCase() ?? "";
}

function parseCapabilities(
  payload: string | null | undefined,
): SupplierCapabilityInput[] {
  if (!payload) {
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    console.error("parseCapabilities: failed to parse payload", {
      payload,
      error,
    });
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const capabilities: SupplierCapabilityInput[] = [];

  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") {
      continue;
    }

    const cap = raw as {
      id?: unknown;
      process?: string | null;
      materials?: unknown;
      certifications?: unknown;
      maxPartSize?: unknown;
    };

    const process =
      typeof cap.process === "string" ? cap.process.trim() : "";
    if (!process) {
      continue;
    }

    const capability: SupplierCapabilityInput = { process };

    if (typeof cap.id === "string" && cap.id.trim().length > 0) {
      capability.id = cap.id.trim();
    }

    const materials = sanitizeStringList(cap.materials);
    if (materials) {
      capability.materials = materials;
    }

    const certifications = sanitizeStringList(cap.certifications);
    if (certifications) {
      capability.certifications = certifications;
    }

    const maxPartSize = sanitizeMaxPartSize(cap.maxPartSize);
    if (maxPartSize !== null) {
      capability.maxPartSize = maxPartSize;
    }

    capabilities.push(capability);
  }

  return capabilities;
}

function sanitizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const cleaned = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return cleaned.length > 0 ? cleaned : undefined;
}

function sanitizeMaxPartSize(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Record<string, unknown>;
  const sanitized = {
    x: sanitizeDimension(source.x),
    y: sanitizeDimension(source.y),
    z: sanitizeDimension(source.z),
    units:
      typeof source.units === "string" ? source.units.trim() : undefined,
  };

  if (
    sanitized.x === undefined &&
    sanitized.y === undefined &&
    sanitized.z === undefined &&
    !sanitized.units
  ) {
    return null;
  }

  return sanitized;
}

function sanitizeDimension(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

async function handleDocumentUploads(
  supplierId: string,
  formData: FormData,
  documentCount: number,
) {
  const tasks: Promise<unknown>[] = [];

  for (let index = 0; index < Math.min(documentCount, MAX_DOCUMENTS); index += 1) {
    const file = formData.get(`document_${index}_file`);
    if (!(file instanceof File) || file.size === 0) {
      continue;
    }
    const docType = getText(formData, `document_${index}_type`);
    tasks.push(uploadDocumentAndPersist(supplierId, file, docType));
  }

  await Promise.all(tasks);
}

async function uploadDocumentAndPersist(
  supplierId: string,
  file: File,
  docType: string | null,
) {
  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const sanitizedName = sanitizeFileName(file.name || "document.pdf");
  const storagePath = `${supplierId}/${Date.now()}-${sanitizedName}`;

  const { error: uploadError } = await supabaseServer.storage
    .from(SUPPLIER_DOCS_BUCKET)
    .upload(storagePath, fileBuffer, {
      upsert: false,
      contentType: file.type || "application/octet-stream",
    });

  if (uploadError) {
    console.error("uploadDocumentAndPersist: storage upload failed", {
      supplierId,
      storagePath,
      error: uploadError,
    });
    throw new Error("Document upload failed");
  }

  const { data: publicUrlData } = supabaseServer.storage
    .from(SUPPLIER_DOCS_BUCKET)
    .getPublicUrl(storagePath);

  if (!publicUrlData?.publicUrl) {
    console.error("uploadDocumentAndPersist: public URL failed", {
      supplierId,
      storagePath,
    });
    throw new Error("Document upload failed");
  }

  await addSupplierDocument(supplierId, {
    fileUrl: publicUrlData.publicUrl,
    docType,
  });
}

function sanitizeFileName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_").toLowerCase();
}
