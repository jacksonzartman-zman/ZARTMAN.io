import { getCustomerByUserId } from "@/server/customers";
import { loadSupplierByUserId } from "@/server/suppliers";

export type UserRole = "customer" | "supplier" | "admin" | "unknown";

export type UserRoleSummary = {
  primaryRole: UserRole;
  isCustomer: boolean;
  isSupplier: boolean;
};

export async function resolveUserRoles(
  userId: string | null | undefined,
): Promise<UserRoleSummary> {
  if (!userId) {
    return {
      primaryRole: "unknown",
      isCustomer: false,
      isSupplier: false,
    };
  }

  const [customer, supplier] = await Promise.all([
    getCustomerByUserId(userId),
    loadSupplierByUserId(userId),
  ]);

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
