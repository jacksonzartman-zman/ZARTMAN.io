import { supabaseServer } from "@/lib/supabaseServer";
import type {
  SupplierApprovalStatus,
  SupplierCapabilityInput,
  SupplierCapabilityRow,
  SupplierDocumentInput,
  SupplierDocumentRow,
  SupplierProfile,
  SupplierProfileUpsertInput,
  SupplierRow,
} from "./types";

const SUPPLIER_SELECT_COLUMNS =
  "id,company_name,primary_email,user_id,phone,website,country,verified,created_at,notify_quote_messages,notify_quote_winner";

function normalizeEmail(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function sanitizeText(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeStringArray(values?: string[] | null): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
}

export function getSupplierApprovalStatus(raw?: {
  status?: string | null;
}): SupplierApprovalStatus {
  const normalized = (raw?.status ?? "pending").toLowerCase().trim();
  if (!normalized) {
    return "pending";
  }
  if (normalized === "approved") {
    return "approved";
  }
  if (normalized === "rejected") {
    return "rejected";
  }
  if (normalized === "unknown") {
    return "unknown";
  }
  return "pending";
}

export function isSupplierApproved(raw?: {
  status?: string | null;
}): boolean {
  return getSupplierApprovalStatus(raw) === "approved";
}

export async function getOrCreateSupplierByEmail(
  primaryEmail: string,
  companyName?: string,
  userId?: string | null,
): Promise<SupplierRow> {
  const email = normalizeEmail(primaryEmail);

  if (!email) {
    throw new Error("primaryEmail is required");
  }

  try {
    const { data: existing, error: lookupError } = await supabaseServer
      .from("suppliers")
      .select(SUPPLIER_SELECT_COLUMNS)
      .eq("primary_email", email)
      .maybeSingle<SupplierRow>();

    if (lookupError) {
      console.error("getOrCreateSupplierByEmail: lookup failed", {
        email,
        error: lookupError,
      });
    }

      if (existing) {
        if (!existing.user_id && userId) {
          const { error: linkError } = await supabaseServer
            .from("suppliers")
            .update({ user_id: userId })
            .eq("id", existing.id);

          if (linkError) {
            console.error("getOrCreateSupplierByEmail: failed to link user", {
              email,
              userId,
              error: linkError,
            });
          } else {
            existing.user_id = userId;
          }
        }
        return existing;
      }

    const payload = {
      primary_email: email,
      company_name:
        sanitizeText(companyName) ??
        email.split("@")[0]?.replace(/\W+/g, " ")?.trim() ??
        "Supplier",
      phone: null,
      website: null,
      country: null,
      verified: false,
        user_id: userId ?? null,
    };

    const { data: created, error: insertError } = await supabaseServer
      .from("suppliers")
      .insert(payload)
      .select(SUPPLIER_SELECT_COLUMNS)
      .single<SupplierRow>();

    if (insertError || !created) {
      console.error("getOrCreateSupplierByEmail: insert failed", {
        email,
        payload,
        error: insertError,
      });
      throw new Error("Unable to create supplier record");
    }

    return created;
  } catch (error) {
    console.error("getOrCreateSupplierByEmail: unexpected error", {
      email,
      error,
    });
    throw error;
  }
}

export async function loadSupplierProfile(
  primaryEmail: string,
): Promise<SupplierProfile | null> {
  const email = normalizeEmail(primaryEmail);
  if (!email) {
    return null;
  }

  try {
    const { data: supplier, error } = await supabaseServer
      .from("suppliers")
      .select(SUPPLIER_SELECT_COLUMNS)
      .eq("primary_email", email)
      .maybeSingle<SupplierRow>();

    if (error) {
      console.error("loadSupplierProfile: supplier lookup failed", {
        email,
        error,
      });
      return null;
    }

    if (!supplier) {
      return null;
    }

    const [capabilities, documents] = await Promise.all([
      listSupplierCapabilities(supplier.id),
      listSupplierDocuments(supplier.id),
    ]);

    const approvalStatus = getSupplierApprovalStatus(supplier);
    return {
      supplier,
      capabilities,
      documents,
      approvalStatus,
      approved: approvalStatus === "approved",
    };
  } catch (error) {
    console.error("loadSupplierProfile: unexpected error", { email, error });
    return null;
  }
}

export async function loadSupplierByPrimaryEmail(
  primaryEmail: string,
): Promise<SupplierRow | null> {
  const email = normalizeEmail(primaryEmail);
  if (!email) {
    return null;
  }

  try {
    const { data, error } = await supabaseServer
      .from("suppliers")
      .select(SUPPLIER_SELECT_COLUMNS)
      .eq("primary_email", email)
      .maybeSingle<SupplierRow>();

    if (error) {
      console.error("loadSupplierByPrimaryEmail: lookup failed", {
        email,
        error,
      });
      return null;
    }

    return data ?? null;
  } catch (error) {
    console.error("loadSupplierByPrimaryEmail: unexpected error", {
      email,
      error,
    });
    return null;
  }
}

export async function loadSupplierById(
  supplierId: string,
): Promise<SupplierRow | null> {
  if (!supplierId) {
    return null;
  }

  try {
    const { data, error } = await supabaseServer
      .from("suppliers")
      .select(SUPPLIER_SELECT_COLUMNS)
      .eq("id", supplierId)
      .maybeSingle<SupplierRow>();

    if (error) {
      console.error("loadSupplierById: lookup failed", {
        supplierId,
        error,
      });
      return null;
    }

    return data ?? null;
  } catch (error) {
    console.error("loadSupplierById: unexpected error", { supplierId, error });
    return null;
  }
}

export async function loadSupplierProfileByUserId(
  userId: string,
): Promise<SupplierProfile | null> {
  const supplier = await loadSupplierByUserId(userId);
  if (!supplier) {
    return null;
  }

  const [capabilities, documents] = await Promise.all([
    listSupplierCapabilities(supplier.id),
    listSupplierDocuments(supplier.id),
  ]);

  const approvalStatus = getSupplierApprovalStatus(supplier);
  return {
    supplier,
    capabilities,
    documents,
    approvalStatus,
    approved: approvalStatus === "approved",
  };
}

export async function loadSupplierByUserId(
  userId: string,
): Promise<SupplierRow | null> {
  if (!userId) {
    return null;
  }

  try {
    const { data, error } = await supabaseServer
      .from("suppliers")
      .select(SUPPLIER_SELECT_COLUMNS)
      .eq("user_id", userId)
      .maybeSingle<SupplierRow>();

    if (error) {
      console.error("loadSupplierByUserId: lookup failed", {
        userId,
        error,
      });
      return null;
    }

    return data ?? null;
  } catch (error) {
    console.error("loadSupplierByUserId: unexpected error", { userId, error });
    return null;
  }
}

export async function upsertSupplierProfile(
  input: SupplierProfileUpsertInput,
  options?: { skipCapabilities?: boolean },
): Promise<SupplierProfile | null> {
  const email = normalizeEmail(input.primaryEmail);
  if (!email) {
    throw new Error("primaryEmail is required");
  }

  const baseSupplier =
    input.supplierId && input.supplierId.length > 0
      ? await loadSupplierById(input.supplierId)
      : null;
  const userLinkedSupplier =
    !baseSupplier && input.userId
      ? await loadSupplierByUserId(input.userId)
      : null;

  const supplier =
    baseSupplier ??
    userLinkedSupplier ??
    (await getOrCreateSupplierByEmail(
      email,
      input.companyName ?? undefined,
      input.userId ?? null,
    ));

  const updatePayload = {
    company_name: sanitizeText(input.companyName) ?? supplier.company_name,
    phone: sanitizeText(input.phone),
    website: sanitizeText(input.website),
    country: sanitizeText(input.country),
    primary_email: email,
    user_id: input.userId ?? supplier.user_id,
  };

  try {
    const { data: updatedSupplier, error: updateError } = await supabaseServer
      .from("suppliers")
      .update(updatePayload)
      .eq("id", supplier.id)
      .select(SUPPLIER_SELECT_COLUMNS)
      .maybeSingle<SupplierRow>();

    if (updateError) {
      console.error("upsertSupplierProfile: supplier update failed", {
        supplierId: supplier.id,
        error: updateError,
      });
      throw new Error("Unable to update supplier record");
    }

    const sanitizedCapabilities = (input.capabilities ?? []).filter(
      (cap) => typeof cap?.process === "string" && cap.process.trim().length > 0,
    );

    if (!options?.skipCapabilities) {
      await upsertSupplierCapabilities(supplier.id, sanitizedCapabilities);
    }

    const [capabilities, documents] = await Promise.all([
      listSupplierCapabilities(supplier.id),
      listSupplierDocuments(supplier.id),
    ]);

    const resolvedSupplier = updatedSupplier ?? supplier;
    const approvalStatus = getSupplierApprovalStatus(resolvedSupplier);
    return {
      supplier: resolvedSupplier,
      capabilities,
      documents,
      approvalStatus,
      approved: approvalStatus === "approved",
    };
  } catch (error) {
    console.error("upsertSupplierProfile: unexpected error", {
      supplierId: supplier.id,
      error,
    });
    throw error;
  }
}

export async function addSupplierDocument(
  supplierId: string,
  document: SupplierDocumentInput,
): Promise<SupplierDocumentRow | null> {
  if (!supplierId) {
    throw new Error("supplierId is required");
  }

  if (!document?.fileUrl) {
    throw new Error("fileUrl is required");
  }

  const payload = {
    supplier_id: supplierId,
    file_url: document.fileUrl,
    doc_type: sanitizeText(document.docType),
  };

  try {
    const { data, error } = await supabaseServer
      .from("supplier_documents")
      .insert(payload)
      .select("*")
      .single<SupplierDocumentRow>();

    if (error) {
      console.error("addSupplierDocument: insert failed", {
        supplierId,
        error,
      });
      throw error;
    }

    return data ?? null;
  } catch (error) {
    console.error("addSupplierDocument: unexpected error", {
      supplierId,
      error,
    });
    throw error;
  }
}

export async function listSupplierCapabilities(
  supplierId: string,
): Promise<SupplierCapabilityRow[]> {
  if (!supplierId) {
    return [];
  }

  try {
    const { data, error } = await supabaseServer
      .from("supplier_capabilities")
      .select("*")
      .eq("supplier_id", supplierId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("listSupplierCapabilities: query failed", {
        supplierId,
        error,
      });
      return [];
    }

    return (data as SupplierCapabilityRow[]) ?? [];
  } catch (error) {
    console.error("listSupplierCapabilities: unexpected error", {
      supplierId,
      error,
    });
    return [];
  }
}

export async function listSupplierDocuments(
  supplierId: string,
): Promise<SupplierDocumentRow[]> {
  if (!supplierId) {
    return [];
  }

  try {
    const { data, error } = await supabaseServer
      .from("supplier_documents")
      .select("*")
      .eq("supplier_id", supplierId)
      .order("uploaded_at", { ascending: false });

    if (error) {
      console.error("listSupplierDocuments: query failed", {
        supplierId,
        error,
      });
      return [];
    }

    return (data as SupplierDocumentRow[]) ?? [];
  } catch (error) {
    console.error("listSupplierDocuments: unexpected error", {
      supplierId,
      error,
    });
    return [];
  }
}

export async function upsertSupplierCapabilities(
  supplierId: string,
  capabilities: SupplierCapabilityInput[],
) {
  try {
    const { error: deleteError } = await supabaseServer
      .from("supplier_capabilities")
      .delete()
      .eq("supplier_id", supplierId);

    if (deleteError) {
      throw deleteError;
    }

    if (capabilities.length === 0) {
      return;
    }

    const payload = capabilities
      .filter(
        (capability) =>
          typeof capability.process === "string" &&
          capability.process.trim().length > 0,
      )
      .map((capability) => ({
        supplier_id: supplierId,
        process:
          typeof capability.process === "string" ? capability.process.trim() : "",
        materials: sanitizeStringArray(capability.materials),
        certifications: sanitizeStringArray(capability.certifications),
        max_part_size: capability.maxPartSize ?? null,
      }));

    if (payload.length === 0) {
      return;
    }

    const { error: insertError } = await supabaseServer
      .from("supplier_capabilities")
      .insert(payload);

    if (insertError) {
      throw insertError;
    }
  } catch (error) {
    console.error("upsertSupplierCapabilities: unexpected error", {
      supplierId,
      error,
    });
    throw error;
  }
}
