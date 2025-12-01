import type { CustomerRow } from "@/server/customers";
import type { SupplierRow } from "@/server/suppliers";

export type NotificationChannel =
  | "quote_message_customer"
  | "quote_message_supplier"
  | "winner_customer"
  | "winner_supplier";

export function customerAllowsNotification(
  customer: CustomerRow | null,
  channel: NotificationChannel,
): boolean {
  if (!customer) {
    return true;
  }

  switch (channel) {
    case "quote_message_customer":
      return customer.notify_quote_messages ?? true;
    case "winner_customer":
      return customer.notify_quote_winner ?? true;
    default:
      return true;
  }
}

export function supplierAllowsNotification(
  supplier: SupplierRow | null,
  channel: NotificationChannel,
): boolean {
  if (!supplier) {
    return true;
  }

  switch (channel) {
    case "quote_message_supplier":
      return supplier.notify_quote_messages ?? true;
    case "winner_supplier":
      return supplier.notify_quote_winner ?? true;
    default:
      return true;
  }
}
