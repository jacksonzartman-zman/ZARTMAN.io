import { supabaseServer } from "@/lib/supabaseServer";
import { hasColumns } from "@/server/db/schemaContract";
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

const SUPPLIER_SELECT_COLUMNS_BASE = [
  "id",
  "company_name",
  "primary_email",
  "user_id",
  "phone",
  "website",
  "country",
  "verified",
  "created_at",
] as const;

let cachedSupplierSelect: Promise<string> | null = null;

async function buildSupplierSelect(): Promise<string> {
  if (cachedSupplierSelect) return cachedSupplierSelect;
  cachedSupplierSelect = (async () => {
    const columns = [...SUPPLIER_SELECT_COLUMNS_BASE];
    const supportsProviderId = await hasColumns("suppliers", ["provider_id"]);
    if (supportsProviderId) {
      columns.push("provider_id");
    }
    return columns.join(",");
  })();
  return cachedSupplierSelect;
}

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
    const { data: existing, error: lookupError } = await supabaseServer()
      .from("suppliers")
      .select(await buildSupplierSelect())
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
          const { error: linkError } = await supabaseServer()
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

    const { data: created, error: insertError } = await supabaseServer()
      .from("suppliers")
      .insert(payload)
      .select(await buildSupplierSelect())
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
    const { data: supplier, error } = await supabaseServer()
      .from("suppliers")
      .select(await buildSupplierSelect())
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
    const { data, error } = await supabaseServer()
      .from("suppliers")
      .select(await buildSupplierSelect())
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
    const { data, error } = await supabaseServer()
      .from("suppliers")
      .select(await buildSupplierSelect())
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

export async function loadSupplierNameMapByIds(
  supplierIds: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const normalizedIds = Array.from(
    new Set(
      (supplierIds ?? [])
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => value.length > 0),
    ),
  );

  const map = new Map<string, string>();
  if (normalizedIds.length === 0) {
    return map;
  }

  try {
    const { data, error } = await supabaseServer()
      .from("suppliers")
      .select("id,company_name,primary_email")
      .in("id", normalizedIds)
      .returns<{ id: string; company_name: string | null; primary_email: string | null }[]>();

    if (error) {
      console.error("loadSupplierNameMapByIds: lookup failed", {
        supplierIdsCount: normalizedIds.length,
        error,
      });
      return map;
    }

    for (const row of data ?? []) {
      const id = typeof row?.id === "string" ? row.id.trim() : "";
      if (!id) continue;
      const name =
        row.company_name?.trim() || row.primary_email?.trim() || null;
      if (name) {
        map.set(id, name);
      }
    }

    return map;
  } catch (error) {
    console.error("loadSupplierNameMapByIds: unexpected error", {
      supplierIdsCount: normalizedIds.length,
      error,
    });
    return map;
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
    const { data, error } = await supabaseServer()
      .from("suppliers")
      .select(await buildSupplierSelect())
      .eq("user_id", userId)
      .maybeSingle<SupplierRow>();

    if (error) {
      console.error("loadSupplierByUserId: lookup failed", {
        userId,
        error,
      });
      return null;
    }

    if (data) {
      return data;
    }

    // Team memberships: suppliers can have multiple portal users via supplier_users.
    // If this user isn't the primary supplier owner, check for a membership row.
    const membership = await supabaseServer()
      .from("supplier_users")
      .select("supplier_id,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle<{ supplier_id: string; created_at: string }>();

    if (membership.error) {
      console.error("loadSupplierByUserId: membership lookup failed", {
        userId,
        error: membership.error,
      });
      return null;
    }

    const supplierId =
      typeof membership.data?.supplier_id === "string"
        ? membership.data.supplier_id
        : "";
    if (!supplierId) {
      return null;
    }

    const { data: supplier, error: supplierError } = await supabaseServer()
      .from("suppliers")
      .select(await buildSupplierSelect())
      .eq("id", supplierId)
      .maybeSingle<SupplierRow>();

    if (supplierError) {
      console.error("loadSupplierByUserId: membership supplier lookup failed", {
        userId,
        supplierId,
        error: supplierError,
      });
      return null;
    }

    return supplier ?? null;
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
    const { data: updatedSupplier, error: updateError } = await supabaseServer()
      .from("suppliers")
      .update(updatePayload)
      .eq("id", supplier.id)
      .select(await buildSupplierSelect())
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
    const { data, error } = await supabaseServer()
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
    const { data, error } = await supabaseServer()
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
    const { data, error } = await supabaseServer()
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
    const { error: deleteError } = await supabaseServer()
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

    const { error: insertError } = await supabaseServer()
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
