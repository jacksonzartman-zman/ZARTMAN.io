import { supabaseServer } from "@/lib/supabaseServer";
import type { MarketplaceEventInput } from "./types";

export async function logMarketplaceEvent(
  event: MarketplaceEventInput,
): Promise<void> {
  try {
    const payload = {
      rfq_id: event.rfqId,
      event_type: event.type,
      actor_id: event.actorId ?? null,
      supplier_id: event.supplierId ?? null,
      customer_id: event.customerId ?? null,
      payload: event.payload ?? {},
    };

    const { error } = await supabaseServer().from("rfq_events").insert(payload);
    if (error) {
      console.error("marketplace: failed to log event", { event, error });
    }
  } catch (error) {
    console.error("marketplace: unexpected event logging error", { event, error });
  }
}
