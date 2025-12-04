import { supabaseServer } from "@/lib/supabaseServer";
import { normalizeQuoteStatus, QUOTE_OPEN_STATUSES } from "@/server/quotes/status";
import { SAFE_QUOTE_WITH_UPLOADS_FIELDS } from "@/server/suppliers/types";
import type { AdminLoaderResult } from "./types";
import type { AdminQuoteListRow } from "./quotes";
import {
  isMissingTableOrColumnError,
  logAdminDashboardError,
  logAdminDashboardInfo,
  logAdminDashboardWarn,
  serializeSupabaseError,
} from "./logging";
import { normalizePriceValue } from "./price";

const DASHBOARD_METRICS_ERROR = "Unable to load dashboard metrics.";

export type AdminDashboardMetrics = {
  totalOpen: number;
  totalWon: number;
  totalLost: number;
  openQuotedValue: number;
  wonQuotedValue: number;
  newToday: number;
  stale48h: number;
};

const EMPTY_METRICS: AdminDashboardMetrics = {
  totalOpen: 0,
  totalWon: 0,
  totalLost: 0,
  openQuotedValue: 0,
  wonQuotedValue: 0,
  newToday: 0,
  stale48h: 0,
};

const SAFE_FIELDS = [...SAFE_QUOTE_WITH_UPLOADS_FIELDS];
const OPEN_STATUS_SET = new Set(QUOTE_OPEN_STATUSES);

export async function loadAdminDashboardMetrics(): Promise<
  AdminLoaderResult<AdminDashboardMetrics>
> {
  try {
    const { data, error } = await supabaseServer
      .from("quotes_with_uploads")
      .select(SAFE_FIELDS.join(","))
      .returns<AdminQuoteListRow[]>();

    if (error) {
      const context = {
        supabaseError: serializeSupabaseError(error),
      };

      if (isMissingTableOrColumnError(error)) {
        logAdminDashboardWarn("metrics missing schema", context);
      } else {
        logAdminDashboardError("metrics query failed", context);
      }

      return {
        ok: false,
        data: EMPTY_METRICS,
        error: DASHBOARD_METRICS_ERROR,
      };
    }

    const rows = data ?? [];
    const now = new Date();
    const metrics = rows.reduce<AdminDashboardMetrics>((acc, row) => {
      const status = normalizeQuoteStatus(row.status);
      const price = normalizePriceValue(row.price);
      const createdAt =
        typeof row.created_at === "string" ? new Date(row.created_at) : null;

      if (createdAt && !Number.isNaN(createdAt.getTime())) {
        const hoursOld = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);

        if (hoursOld <= 24) {
          acc.newToday += 1;
        }

        if (OPEN_STATUS_SET.has(status) && hoursOld > 48) {
          acc.stale48h += 1;
        }
      }

      if (OPEN_STATUS_SET.has(status)) {
        acc.totalOpen += 1;
        if (typeof price === "number") {
          acc.openQuotedValue += price;
        }
        return acc;
      }

      if (status === "won") {
        acc.totalWon += 1;
        if (typeof price === "number") {
          acc.wonQuotedValue += price;
        }
        return acc;
      }

      if (status === "lost") {
        acc.totalLost += 1;
      }

      return acc;
    }, { ...EMPTY_METRICS });

    logAdminDashboardInfo("metrics loaded", metrics);

    return {
      ok: true,
      data: metrics,
      error: null,
    };
  } catch (error) {
    logAdminDashboardError("metrics crashed", {
      supabaseError: serializeSupabaseError(error),
    });
    return {
      ok: false,
      data: EMPTY_METRICS,
      error: DASHBOARD_METRICS_ERROR,
    };
  }
}
