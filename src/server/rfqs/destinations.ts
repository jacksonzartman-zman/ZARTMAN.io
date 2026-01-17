import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";

export type RfqDestinationStatus =
  | "draft"
  | "queued"
  | "sent"
  | "viewed"
  | "quoted"
  | "declined"
  | "error";

export type RfqDestinationProvider = {
  name: string | null;
  provider_type: string | null;
  quoting_mode: string | null;
};

export type RfqDestination = {
  id: string;
  rfq_id: string;
  provider_id: string;
  status: RfqDestinationStatus;
  sent_at: string | null;
  last_status_at: string;
  external_reference: string | null;
  error_message: string | null;
  created_at: string;
  provider: RfqDestinationProvider | null;
};

type RawRfqDestinationRow = {
  id: string | null;
  rfq_id: string | null;
  provider_id: string | null;
  status: string | null;
  sent_at: string | null;
  last_status_at: string | null;
  external_reference: string | null;
  error_message: string | null;
  created_at: string | null;
  provider: RfqDestinationProvider | null;
};

const DESTINATION_SELECT = [
  "id",
  "rfq_id",
  "provider_id",
  "status",
  "sent_at",
  "last_status_at",
  "external_reference",
  "error_message",
  "created_at",
  "provider:providers(name,provider_type,quoting_mode)",
].join(",");

const DESTINATION_STATUSES: ReadonlySet<RfqDestinationStatus> = new Set([
  "draft",
  "queued",
  "sent",
  "viewed",
  "quoted",
  "declined",
  "error",
]);

export async function getRfqDestinations(rfqId: string): Promise<RfqDestination[]> {
  const normalizedId = normalizeId(rfqId);
  if (!normalizedId) {
    return [];
  }

  try {
    const { data, error } = await supabaseServer
      .from("rfq_destinations")
      .select(DESTINATION_SELECT)
      .eq("rfq_id", normalizedId)
      .order("created_at", { ascending: true })
      .returns<RawRfqDestinationRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        console.warn("[rfq destinations] missing schema; returning empty", {
          rfqId: normalizedId,
          supabaseError: serializeSupabaseError(error),
        });
        return [];
      }
      console.error("[rfq destinations] query failed", {
        rfqId: normalizedId,
        supabaseError: serializeSupabaseError(error),
      });
      return [];
    }

    const rows = Array.isArray(data) ? data : [];
    return rows
      .map((row) => normalizeDestinationRow(row))
      .filter((row): row is RfqDestination => Boolean(row));
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      console.warn("[rfq destinations] missing schema; returning empty", {
        rfqId: normalizedId,
        supabaseError: serializeSupabaseError(error),
      });
      return [];
    }
    console.error("[rfq destinations] unexpected error", {
      rfqId: normalizedId,
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

function normalizeDestinationRow(row: RawRfqDestinationRow): RfqDestination | null {
  const id = normalizeId(row?.id);
  const rfqId = normalizeId(row?.rfq_id);
  const providerId = normalizeId(row?.provider_id);
  if (!id || !rfqId || !providerId) {
    return null;
  }

  const createdAt = row?.created_at ?? new Date().toISOString();
  const lastStatusAt = row?.last_status_at ?? createdAt;

  return {
    id,
    rfq_id: rfqId,
    provider_id: providerId,
    status: normalizeDestinationStatus(row?.status),
    sent_at: row?.sent_at ?? null,
    last_status_at: lastStatusAt,
    external_reference: row?.external_reference ?? null,
    error_message: row?.error_message ?? null,
    created_at: createdAt,
    provider: row?.provider ?? null,
  };
}

function normalizeDestinationStatus(value: string | null | undefined): RfqDestinationStatus {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (DESTINATION_STATUSES.has(normalized as RfqDestinationStatus)) {
    return normalized as RfqDestinationStatus;
  }
  return "draft";
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
