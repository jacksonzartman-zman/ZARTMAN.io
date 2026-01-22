import { supabaseServer } from "@/lib/supabaseServer";
import { schemaGate } from "@/server/db/schemaContract";
import {
  handleMissingSupabaseRelation,
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";

type IntroRequestRow = {
  quote_id: string | null;
  requested_at: string | null;
};

type OpsEventRow = {
  quote_id: string | null;
  event_type: string | null;
  created_at: string | null;
};

export async function hasCustomerIntroRequested(quoteId: string): Promise<boolean> {
  const normalizedQuoteId = typeof quoteId === "string" ? quoteId.trim() : "";
  if (!normalizedQuoteId) return false;

  const introRequestsSupported = await schemaGate({
    enabled: true,
    relation: "intro_requests",
    requiredColumns: ["quote_id", "provider_id", "status", "requested_at"],
    warnPrefix: "[customer intro requested]",
    warnKey: "customer_intro_requested:intro_requests",
  });

  if (introRequestsSupported) {
    try {
      const { data, error } = await supabaseServer
        .from("intro_requests")
        .select("quote_id,requested_at")
        .eq("quote_id", normalizedQuoteId)
        .limit(1)
        .returns<IntroRequestRow[]>();

      if (error) {
        if (
          handleMissingSupabaseRelation({
            relation: "intro_requests",
            error,
            warnPrefix: "[customer intro requested]",
          })
        ) {
          // Fall back to ops_events below.
        } else if (!isMissingTableOrColumnError(error)) {
          console.warn("[customer intro requested] intro_requests query failed; falling back", {
            quoteId: normalizedQuoteId,
            error: serializeSupabaseError(error) ?? error,
          });
        }
      } else {
        return (Array.isArray(data) ? data : []).length > 0;
      }
    } catch (error) {
      if (
        handleMissingSupabaseRelation({
          relation: "intro_requests",
          error,
          warnPrefix: "[customer intro requested]",
        })
      ) {
        // Fall back to ops_events below.
      } else if (!isMissingTableOrColumnError(error)) {
        console.warn("[customer intro requested] intro_requests query crashed; falling back", {
          quoteId: normalizedQuoteId,
          error: serializeSupabaseError(error) ?? error,
        });
      }
    }
  }

  // Back-compat fallback: ops_events (some environments only track intro requests here).
  const opsEventsSupported = await schemaGate({
    enabled: true,
    relation: "ops_events",
    requiredColumns: ["quote_id", "event_type", "created_at", "payload"],
    warnPrefix: "[customer intro requested]",
    warnKey: "customer_intro_requested:ops_events",
  });
  if (!opsEventsSupported) return false;

  try {
    const { data, error } = await supabaseServer
      .from("ops_events")
      .select("quote_id,event_type,created_at")
      .eq("quote_id", normalizedQuoteId)
      .eq("event_type", "customer_intro_requested")
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<OpsEventRow[]>();

    if (error) {
      if (
        handleMissingSupabaseRelation({
          relation: "ops_events",
          error,
          warnPrefix: "[customer intro requested]",
        })
      ) {
        return false;
      }
      if (!isMissingTableOrColumnError(error)) {
        console.warn("[customer intro requested] ops_events query failed", {
          quoteId: normalizedQuoteId,
          error: serializeSupabaseError(error) ?? error,
        });
      }
      return false;
    }

    return (Array.isArray(data) ? data : []).length > 0;
  } catch (error) {
    if (
      handleMissingSupabaseRelation({
        relation: "ops_events",
        error,
        warnPrefix: "[customer intro requested]",
      })
    ) {
      return false;
    }
    if (!isMissingTableOrColumnError(error)) {
      console.warn("[customer intro requested] ops_events query crashed", {
        quoteId: normalizedQuoteId,
        error: serializeSupabaseError(error) ?? error,
      });
    }
    return false;
  }
}

