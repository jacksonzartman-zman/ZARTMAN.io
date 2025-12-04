"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  addSupplierDocument,
  upsertSupplierCapabilities,
  upsertSupplierProfile,
  type SupplierCapabilityInput,
} from "@/server/suppliers";
import { requireUser } from "@/server/auth";

export type SupplierOnboardingState = {
  ok: boolean;
  profileSaved: boolean;
  partial?: boolean;
  error: string | null;
  fieldErrors?: Record<string, string>;
};

const GENERIC_ONBOARDING_ERROR =
  "We couldn’t save your profile. Please try again.";

const SUPPLIER_DOCS_BUCKET =
  process.env.SUPPLIER_DOCS_BUCKET ||
  process.env.NEXT_PUBLIC_SUPPLIER_DOCS_BUCKET ||
  "supplier-docs";

const MAX_DOCUMENTS = 5;

function isNextRedirectError(error: unknown): error is { digest?: string } {
  if (!error || typeof error !== "object") {
    return false;
  }
  const digest =
    "digest" in error && typeof (error as { digest?: unknown }).digest === "string"
      ? (error as { digest: string }).digest
      : null;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

export async function submitSupplierOnboardingAction(
  _prevState: SupplierOnboardingState,
  formData: FormData,
): Promise<SupplierOnboardingState> {
  const user = await requireUser({ redirectTo: "/supplier/onboarding" });
  const userId = user.id;
  const rawCompanyName = getText(formData, "company_name");
  const rawPrimaryEmail = getText(formData, "primary_email");
  const normalizedPrimaryEmail =
    normalizeEmail(rawPrimaryEmail) ??
    normalizeEmail(user.email ?? null);
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
    return {
      ok: false,
      profileSaved: false,
      error: "Check the highlighted fields.",
      fieldErrors,
    };
  }

  const primaryEmail: string = normalizedPrimaryEmail!;
  const safeCompanyName: string = rawCompanyName!.trim();

  const capabilities = parseCapabilities(capabilitiesPayload);
  const logContext = {
    userId,
    email: primaryEmail,
    supplierId: supplierId ?? null,
  };

  console.log("[supplier onboarding] start", logContext);

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
    }, { skipCapabilities: true });

    if (!profile?.supplier) {
      console.error("[supplier onboarding] supplier upsert returned empty", logContext);
      return {
        ok: false,
        profileSaved: false,
        error: GENERIC_ONBOARDING_ERROR,
        fieldErrors: {},
      };
    }

    const supplierRecordId = profile.supplier.id;
    const supplierLogContext = { ...logContext, supplierId: supplierRecordId };
    console.log("[supplier onboarding] supplier upsert result", supplierLogContext);

    let partial = false;

    try {
      await upsertSupplierCapabilities(supplierRecordId, capabilities);
      console.log("[supplier onboarding] capabilities upsert result", {
        ...supplierLogContext,
        capabilityCount: capabilities.length,
      });
    } catch (capabilitiesError) {
      if (isMissingTableOrColumnError(capabilitiesError)) {
        partial = true;
        logOptionalStepSkipped("capabilities", capabilitiesError, supplierLogContext);
      } else {
        throw capabilitiesError;
      }
    }

    try {
      const uploadedDocs = await handleDocumentUploads(
        supplierRecordId,
        formData,
        documentCount,
      );
      console.log("[supplier onboarding] documents upsert result", {
        ...supplierLogContext,
        uploadedDocs,
      });
    } catch (documentsError) {
      if (isMissingTableOrColumnError(documentsError)) {
        partial = true;
        logOptionalStepSkipped("documents", documentsError, supplierLogContext);
      } else {
        throw documentsError;
      }
    }

    revalidatePath("/supplier");
    console.log("[supplier onboarding] complete", {
      ...supplierLogContext,
      partial,
    });

    if (!partial) {
      redirect(`/supplier?onboard=1`);
    }

    return {
      ok: true,
      profileSaved: true,
      partial: true,
      error: null,
      fieldErrors: {},
    };
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }

    console.error("[supplier onboarding] unexpected failure", {
      ...logContext,
      error: serializeSupabaseError(error),
    });
    return {
      ok: false,
      profileSaved: false,
      partial: false,
      error: GENERIC_ONBOARDING_ERROR,
      fieldErrors: {},
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
): Promise<number> {
  const tasks: Promise<unknown>[] = [];

  for (let index = 0; index < Math.min(documentCount, MAX_DOCUMENTS); index += 1) {
    const file = formData.get(`document_${index}_file`);
    if (!(file instanceof File) || file.size === 0) {
      continue;
    }
    const docType = getText(formData, `document_${index}_type`);
    tasks.push(uploadDocumentAndPersist(supplierId, file, docType));
  }

  if (tasks.length === 0) {
    return 0;
  }

  await Promise.all(tasks);
  return tasks.length;
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

type SupplierOnboardingLogContext = {
  userId: string;
  email?: string | null;
  supplierId?: string | null;
};

function logOptionalStepSkipped(
  stage: string,
  error: unknown,
  context: SupplierOnboardingLogContext,
) {
  console.warn("[supplier onboarding] optional step skipped due to missing schema", {
    ...context,
    stage,
    supabaseError: serializeSupabaseError(error),
  });
}

function isMissingTableOrColumnError(error: unknown): boolean {
  const source = extractSupabaseSource(error);
  if (!source || typeof source !== "object") {
    return false;
  }
  const code =
    "code" in source && typeof (source as { code?: unknown }).code === "string"
      ? ((source as { code?: string }).code as string)
      : null;
  return code === "PGRST205" || code === "42703";
}

function extractSupabaseSource(error: unknown): unknown {
  if (
    error &&
    typeof error === "object" &&
    "supabaseError" in error &&
    (error as { supabaseError?: unknown }).supabaseError
  ) {
    return (error as { supabaseError?: unknown }).supabaseError;
  }
  return error;
}

function serializeSupabaseError(error: unknown) {
  const source = extractSupabaseSource(error);
  if (!source || typeof source !== "object") {
    return source ?? null;
  }
  const maybe = source as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
    hint?: unknown;
  };
  return {
    code: typeof maybe.code === "string" ? maybe.code : null,
    message: typeof maybe.message === "string" ? maybe.message : null,
    details: typeof maybe.details === "string" ? maybe.details : null,
    hint: typeof maybe.hint === "string" ? maybe.hint : null,
  };
}
