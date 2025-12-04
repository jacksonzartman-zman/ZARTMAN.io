import { loadCustomerActivityFeed, loadSupplierActivityFeed } from "@/server/activity";
import { getCustomerByUserId } from "@/server/customers";
import { loadSupplierProfile } from "@/server/suppliers";
import type { SupplierActivityResult } from "@/server/suppliers/types";
import type { ActivityItem } from "@/types/activity";
import type { NotificationPayload } from "@/types/notifications";

type LoadNotificationsArgs = {
  userId?: string | null;
  email?: string | null;
  limit?: number;
};

const DEFAULT_NOTIFICATION_LIMIT = 12;

export async function loadNotificationsForUser(
  args: LoadNotificationsArgs,
): Promise<NotificationPayload[]> {
  const limit = args.limit ?? DEFAULT_NOTIFICATION_LIMIT;
  if (!args.userId && !args.email) {
    return [];
  }

  const [customer, supplierProfile] = await Promise.all([
    args.userId ? getCustomerByUserId(args.userId) : Promise.resolve(null),
    args.email ? loadSupplierProfile(args.email) : Promise.resolve(null),
  ]);

  const customerActivityPromise = customer
    ? loadCustomerActivityFeed({
        customerId: customer.id,
        email: customer.email ?? args.email ?? null,
        domain: extractDomain(customer.email ?? args.email ?? null),
        limit,
      })
    : Promise.resolve([]);

  const supplierActivityPromise: Promise<
    SupplierActivityResult<ActivityItem[]>
  > = supplierProfile?.supplier
    ? loadSupplierActivityFeed({
        supplierId: supplierProfile.supplier.id,
        supplierEmail:
          supplierProfile.supplier.primary_email ?? args.email ?? null,
        limit,
      })
    : Promise.resolve({
        ok: true,
        data: [],
      });

  const [customerActivity, supplierActivityResult] = await Promise.all([
    customerActivityPromise,
    supplierActivityPromise,
  ]);

  const supplierActivity = supplierActivityResult.ok
    ? supplierActivityResult.data
    : [];

  const combined: NotificationPayload[] = [
    ...customerActivity.map((item) => ({
      ...item,
      source: "customer" as const,
      read: false,
    })),
    ...supplierActivity.map((item) => ({
      ...item,
      source: "supplier" as const,
      read: false,
    })),
  ];

  return combined
    .sort((a, b) => {
      const aTime = Date.parse(a.timestamp) || 0;
      const bTime = Date.parse(b.timestamp) || 0;
      return bTime - aTime;
    })
    .slice(0, limit);
}

function extractDomain(email?: string | null): string | null {
  if (!email || !email.includes("@")) {
    return null;
  }
  const [, domain] = email.split("@");
  return domain?.toLowerCase() ?? null;
}
