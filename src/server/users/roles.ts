import { getCustomerByUserId } from "@/server/customers";
import { loadSupplierByUserId } from "@/server/suppliers";
import { requireSchema } from "@/server/db/schemaContract";
import { isDemoModeEnabled } from "@/server/demo/demoMode";

export type UserRole = "customer" | "supplier" | "admin" | "unknown";

export type UserRoleSummary = {
  primaryRole: UserRole;
  isCustomer: boolean;
  isSupplier: boolean;
};

type CustomerRecord = Awaited<ReturnType<typeof getCustomerByUserId>>;
type SupplierRecord = Awaited<ReturnType<typeof loadSupplierByUserId>>;

type ResolveUserRolesDeps = {
  getCustomerByUserId?: typeof getCustomerByUserId;
  loadSupplierByUserId?: typeof loadSupplierByUserId;
  requireSchema?: typeof requireSchema;
  isDemoModeEnabled?: typeof isDemoModeEnabled;
};

let DID_LOG_SUPPLIER_ROLE_SKIPPED_MISSING_SUPPLIERS_RELATION = false;

export async function resolveUserRoles(
  userId: string | null | undefined,
  preloaded?: {
    customer?: CustomerRecord;
    supplier?: SupplierRecord;
  },
  deps?: ResolveUserRolesDeps,
): Promise<UserRoleSummary> {
  if (!userId) {
    console.log("[roles] resolveUserRoles called without user id");
    return {
      primaryRole: "unknown",
      isCustomer: false,
      isSupplier: false,
    };
  }

  console.log("[roles] resolving roles", { userId });

  const getCustomer = deps?.getCustomerByUserId ?? getCustomerByUserId;
  const getSupplier = deps?.loadSupplierByUserId ?? loadSupplierByUserId;
  const requireSchemaFn = deps?.requireSchema ?? requireSchema;
  const demoEnabled = (deps?.isDemoModeEnabled ?? isDemoModeEnabled)();

  let customer = preloaded?.customer;
  let supplier = preloaded?.supplier;

  // Resolve customer independently (never let supplier checks block customer role).
  if (customer === undefined) {
    try {
      customer = await getCustomer(userId);
    } catch (error) {
      console.error("[roles] customer lookup failed", { userId, error });
      customer = null;
    }
  }

  // Resolve supplier independently, but schema-gate supplier role on the `suppliers` relation.
  // If the relation is missing (per schema_contract), treat isSupplier as false, do not attempt
  // supplier lookups, and keep the customer role if present.
  let suppliersRelationMissing = false;
  try {
    const suppliersSchema = await requireSchemaFn({
      relation: "suppliers",
      // Keep it column-agnostic to avoid assuming `id` in legacy environments.
      requiredColumns: [],
      warnPrefix: "[roles]",
      warnKey: "roles:suppliers",
    });
    suppliersRelationMissing = !suppliersSchema.ok && suppliersSchema.reason === "missing_relation";
  } catch (error) {
    // If schema probing fails unexpectedly, don't block supplier resolution.
    // (Only skip supplier role when schema_contract explicitly reports missing_relation.)
    suppliersRelationMissing = false;
    if (!demoEnabled) {
      console.error("[roles] suppliers schema probe failed", { userId, error });
    } else {
      console.warn("[roles] suppliers schema probe failed (demo-safe)", { userId, error: String(error) });
    }
  }

  if (suppliersRelationMissing) {
    if (!DID_LOG_SUPPLIER_ROLE_SKIPPED_MISSING_SUPPLIERS_RELATION) {
      DID_LOG_SUPPLIER_ROLE_SKIPPED_MISSING_SUPPLIERS_RELATION = true;
      console.info("[roles] supplier role skipped due to missing suppliers relation");
    }
    // Even if a supplier was preloaded, do not grant supplier role when the relation is absent.
    supplier = null;
  } else if (supplier === undefined) {
    try {
      supplier = await getSupplier(userId);
    } catch (error) {
      // Demo safety: never let supplier resolution crash role resolution.
      if (!demoEnabled) {
        console.error("[roles] supplier lookup failed", { userId, error });
      } else {
        console.warn("[roles] supplier lookup failed (demo-safe)", { userId, error: String(error) });
      }
      supplier = null;
    }
  }

  // Final schema gate: even if upstream code preloaded/merged supplier flags or a supplier record,
  // supplier role must always be false when schema_contract reports `suppliers` is missing.
  // (This also ensures our "resolved roles" log reflects post-gate values.)
  const isCustomer = Boolean(customer);
  const isSupplier = suppliersRelationMissing ? false : Boolean(supplier);

  let primaryRole: UserRole = "unknown";
  if (isCustomer && !isSupplier) {
    primaryRole = "customer";
  } else if (!isCustomer && isSupplier) {
    primaryRole = "supplier";
  } else if (isCustomer && isSupplier) {
    // Deterministic tie-break: prefer customer UX unless explicitly handled elsewhere.
    primaryRole = "customer";
  }

  console.log("[roles] resolved roles", {
    userId,
    primaryRole,
    isCustomer,
    isSupplier,
    suppliersRelationMissing,
  });

  return {
    primaryRole,
    isCustomer,
    isSupplier,
  };
}
