import { getCustomerByUserId } from "@/server/customers";
import { loadSupplierByUserId } from "@/server/suppliers";

export type UserRole = "customer" | "supplier" | "admin" | "unknown";

export type UserRoleSummary = {
  primaryRole: UserRole;
  isCustomer: boolean;
  isSupplier: boolean;
};

type CustomerRecord = Awaited<ReturnType<typeof getCustomerByUserId>>;
type SupplierRecord = Awaited<ReturnType<typeof loadSupplierByUserId>>;

export async function resolveUserRoles(
  userId: string | null | undefined,
  preloaded?: {
    customer?: CustomerRecord;
    supplier?: SupplierRecord;
  },
): Promise<UserRoleSummary> {
  if (!userId) {
    return {
      primaryRole: "unknown",
      isCustomer: false,
      isSupplier: false,
    };
  }

  let customer = preloaded?.customer;
  let supplier = preloaded?.supplier;

  if (customer === undefined || supplier === undefined) {
    const [resolvedCustomer, resolvedSupplier] = await Promise.all([
      customer === undefined ? getCustomerByUserId(userId) : Promise.resolve(customer),
      supplier === undefined ? loadSupplierByUserId(userId) : Promise.resolve(supplier),
    ]);
    customer = resolvedCustomer;
    supplier = resolvedSupplier;
  }

  const isCustomer = Boolean(customer);
  const isSupplier = Boolean(supplier);

  let primaryRole: UserRole = "unknown";
  if (isCustomer && !isSupplier) {
    primaryRole = "customer";
  } else if (!isCustomer && isSupplier) {
    primaryRole = "supplier";
  }

  return {
    primaryRole,
    isCustomer,
    isSupplier,
  };
}
