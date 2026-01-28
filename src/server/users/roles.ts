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

  // Resolve supplier independently, but short-circuit when the suppliers relation is missing.
  if (supplier === undefined) {
    try {
      const suppliersSchema = await requireSchemaFn({
        relation: "suppliers",
        // Keep it column-agnostic to avoid assuming `id` in legacy environments.
        requiredColumns: [],
        warnPrefix: "[roles]",
        warnKey: "roles:suppliers",
      });

      if (!suppliersSchema.ok && suppliersSchema.reason === "missing_relation") {
        // Demo-safe: treat supplier membership as false if the table isn't present.
        supplier = null;
      } else {
        supplier = await getSupplier(userId);
      }
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

  const isCustomer = Boolean(customer);
  const isSupplier = Boolean(supplier);

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
  });

  return {
    primaryRole,
    isCustomer,
    isSupplier,
  };
}
