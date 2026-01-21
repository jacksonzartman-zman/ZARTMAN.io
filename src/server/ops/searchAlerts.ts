import type { OpsEventRecord } from "@/server/ops/events";

const SEARCH_ALERT_EVENT_TYPES = new Set([
  "search_alert_enabled",
  "search_alert_disabled",
]);

export function deriveSearchAlertPreferenceFromOpsEvents(
  opsEvents: OpsEventRecord[] | null | undefined,
): boolean | null {
  if (!Array.isArray(opsEvents) || opsEvents.length === 0) {
    return null;
  }

  let fallback: boolean | null = null;
  let latest: { enabled: boolean; timestamp: number } | null = null;

  for (const event of opsEvents) {
    if (!SEARCH_ALERT_EVENT_TYPES.has(event.event_type)) {
      continue;
    }
    const enabled = event.event_type === "search_alert_enabled";
    if (fallback === null) {
      fallback = enabled;
    }
    const parsed = Date.parse(event.created_at);
    if (!Number.isFinite(parsed)) {
      continue;
    }
    if (!latest || parsed > latest.timestamp) {
      latest = { enabled, timestamp: parsed };
    }
  }

  return latest?.enabled ?? fallback;
}
