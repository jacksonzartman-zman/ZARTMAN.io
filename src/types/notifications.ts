import type { ActivityItem } from "./activity";

export type NotificationPayload = ActivityItem & {
  read?: boolean;
  source?: "customer" | "supplier";
};
