"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  addSupplierDocument,
  upsertSupplierProfile,
  type SupplierCapabilityInput,
} from "@/server/suppliers";
import { requireSession } from "@/server/auth";

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
  const session = await requireSession({ redirectTo: "/supplier/onboarding" });
  const userId = session.user.id;
  const rawCompanyName = getText(formData, "company_name");
  const rawPrimaryEmail = getText(formData, "primary_email");
  const normalizedPrimaryEmail =
    normalizeEmail(rawPrimaryEmail) ??
    normalizeEmail(session.user.email ?? null);
  const phone = getText(formData, "phone");
  const website = getText(formData, "website");
  const country = getText(formData, "country");
  const capabilitiesPayload = getText(formData, "capabilities_payload");
  const documentCount = Number(formData.get("document_count") ?? 0);
  const supplierId = getText(formData, "supplier_id");

  const fieldErrors: Record<string, string> = {};

  if (!rawCompanyName || !rawCompanyName.trim()) {
    fieldErrors.company_name = "Enter your company name.";
  }

  if (!normalizedPrimaryEmail) {
    fieldErrors.primary_email = "Enter a valid primary email.";
  }

  if (documentCount > MAX_DOCUMENTS) {
    fieldErrors.documents = `Limit uploads to ${MAX_DOCUMENTS} files.`;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { success: false, error: "Check the highlighted fields.", fieldErrors };
  }

    const primaryEmail: string = normalizedPrimaryEmail!;
  const safeCompanyName: string = rawCompanyName!.trim();

  const capabilities = parseCapabilities(capabilitiesPayload);

  try {
    const profile = await upsertSupplierProfile({
        supplierId: supplierId ?? undefined,
      primaryEmail,
      companyName: safeCompanyName,
      phone,
      website,
      country,
      capabilities,
        userId,
    });

    if (!profile?.supplier) {
      return {
        success: false,
        error: "Unable to save your profile. Please try again.",
      };
    }

    await handleDocumentUploads(profile.supplier.id, formData, documentCount);

    revalidatePath("/supplier");
      redirect(`/supplier?onboard=1`);
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

function normalizeEmail(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function parseCapabilities(payload: string | null): SupplierCapabilityInput[] {
  if (!payload) {
    return [];
  }

  try {
    const parsed = JSON.parse(payload);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => normalizeCapability(entry))
        .filter((cap): cap is SupplierCapabilityInput => {
          if (!cap || typeof cap.process !== "string") {
            return false;
          }
          return cap.process.trim().length > 0;
        });
  } catch (error) {
    console.error("parseCapabilities: failed to parse payload", {
      payload,
      error,
    });
    return [];
  }
}

function normalizeCapability(entry: any): SupplierCapabilityInput | null {
  if (!entry) {
    return null;
  }

  const process =
    typeof entry.process === "string" ? entry.process.trim() : "";
  if (!process) {
    return null;
  }

  const materials = Array.isArray(entry.materials)
    ? entry.materials
        .map((value: unknown) =>
          typeof value === "string" ? value.trim() : "",
        )
        .filter((value: string) => value.length > 0)
    : [];

  const certifications = Array.isArray(entry.certifications)
    ? entry.certifications
        .map((value: unknown) =>
          typeof value === "string" ? value.trim() : "",
        )
        .filter((value: string) => value.length > 0)
    : [];

  const maxPartSize =
    entry.maxPartSize && typeof entry.maxPartSize === "object"
      ? {
          x: sanitizeDimension(entry.maxPartSize.x),
          y: sanitizeDimension(entry.maxPartSize.y),
          z: sanitizeDimension(entry.maxPartSize.z),
          units: typeof entry.maxPartSize.units === "string"
            ? entry.maxPartSize.units.trim()
            : undefined,
        }
      : null;

  return {
    process,
    materials,
    certifications,
    maxPartSize,
  };
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
