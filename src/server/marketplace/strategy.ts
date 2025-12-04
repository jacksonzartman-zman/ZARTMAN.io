import { supabaseServer } from "@/lib/supabaseServer";
import { logMarketplaceEvent } from "./events";
import { OPEN_RFQ_STATUSES } from "./rfqs";
import type { MarketplaceRfq, RfqBidRecord } from "./types";
import { isMissingRfqTableError, isRfqsFeatureEnabled } from "./flags";

const DAY_MS = 86_400_000;
const GENERAL_PROCESS = "general";

export type CustomerPriorityTier = "critical" | "expedited" | "standard" | "deferred";

export type ProcessImbalanceSignal = {
  process: string;
  supply: number;
  demand: number;
  imbalance: number;
  tension: "shortage" | "balanced" | "surplus";
};

export type ResponsePressure = {
  level: "low" | "medium" | "high";
  index: number;
  drivers: string[];
};

export type MarketPowerProfile = {
  rfqId: string;
  supplierCompetitiveness: number;
  supplierPosture: "supplier_power" | "balanced" | "buyer_power";
  supplyDemand: ProcessImbalanceSignal[];
  responsePressure: ResponsePressure;
  customerPriorityTier: CustomerPriorityTier;
  customerPriorityScore: number;
  diagnostics: {
    bidCount: number;
    uniqueBiddingSuppliers: number;
    estimatedQualifiedSuppliers: number;
    scarcityIndex: number;
  };
};

export type CustomerPriorityProfile = {
  rfqId: string;
  customerId: string | null;
  tier: CustomerPriorityTier;
  score: number;
  drivers: {
    declaredPriority: number;
    urgency: number;
    loyalty: number;
    valueDensity: number;
    awardMomentum: number;
  };
};

export type SupplierLeverageProfile = {
  rfqId: string;
  supplierId: string;
  leverageScore: number;
  posture: "price_setter" | "balanced" | "price_taker";
  supplierCompetitiveness: number;
  responsePressure: MarketPowerProfile["responsePressure"];
  customerPriorityTier: CustomerPriorityTier;
  supplyDemand: ProcessImbalanceSignal[];
  reasoning: {
    scarcityImpact: number;
    marketCoverageGap: number;
    winRate: number;
    totalBids: number;
    hasActiveBid: boolean;
  };
};

type StrategyOptions = {
  bids?: RfqBidRecord[];
  logEvent?: boolean;
};

type SupplierLeverageOptions = StrategyOptions;

export async function marketplacePowerProfile(
  rfq: MarketplaceRfq,
  options?: StrategyOptions,
): Promise<MarketPowerProfile> {
  const bids = options?.bids ?? (await fetchBidsForRfq(rfq.id));
  const processes = normalizeProcessArray(rfq.process_requirements);
  const uniqueProcesses = processes.length > 0 ? processes : [GENERAL_PROCESS];

  const [{ perProcessSupply, totalUniqueSuppliers }, demandCounts] = await Promise.all([
    estimateProcessSupply(uniqueProcesses),
    fetchProcessDemand(uniqueProcesses),
  ]);

  const supplyDemand = uniqueProcesses.map<ProcessImbalanceSignal>((process) => {
    const supply = perProcessSupply[process] ?? 0;
    const demand = demandCounts[process] ?? 0;
    const imbalance = demand - supply;
    const tension =
      imbalance >= 2 ? "shortage" : imbalance <= -2 ? "surplus" : "balanced";
    return {
      process,
      supply,
      demand,
      imbalance,
      tension,
    };
  });

  const uniqueBidders = new Set(
    bids
      .filter((bid) => bid.status !== "withdrawn")
      .map((bid) => bid.supplier_id),
  ).size;

  const estimatedQualifiedSuppliers =
    totalUniqueSuppliers > 0 ? totalUniqueSuppliers : uniqueBidders || 1;

  const scarcityIndex =
    supplyDemand.length > 0
      ? supplyDemand.reduce((sum, signal) => {
          const ratio = signal.demand / Math.max(signal.supply, 1);
          return sum + ratio;
        }, 0) / supplyDemand.length
      : 0;

  const coverage = clamp(uniqueBidders / Math.max(estimatedQualifiedSuppliers, 1), 0, 1);
  const supplierCompetitiveness = clamp(
    0.6 * clamp(scarcityIndex / 2, 0, 1) + 0.4 * (1 - coverage),
    0,
    1,
  );

  const supplierPosture =
    supplierCompetitiveness >= 0.65
      ? "supplier_power"
      : supplierCompetitiveness <= 0.35
        ? "buyer_power"
        : "balanced";

  const responsePressure = computeResponsePressure({
    rfq,
    scarcityIndex,
    coverage,
    bidCount: bids.length,
  });

  const customerPriority = await customerPriorityProfile(rfq);

  const profile: MarketPowerProfile = {
    rfqId: rfq.id,
    supplierCompetitiveness,
    supplierPosture,
    supplyDemand,
    responsePressure,
    customerPriorityTier: customerPriority.tier,
    customerPriorityScore: customerPriority.score,
    diagnostics: {
      bidCount: bids.length,
      uniqueBiddingSuppliers: uniqueBidders,
      estimatedQualifiedSuppliers,
      scarcityIndex,
    },
  };

  if (options?.logEvent !== false) {
    await logMarketplaceEvent({
      rfqId: rfq.id,
      type: "market_pressure_calculated",
      customerId: rfq.customer_id ?? null,
      payload: {
        supplier_competitiveness: supplierCompetitiveness,
        supplier_posture: supplierPosture,
        response_pressure: responsePressure,
        customer_priority_tier: customerPriority.tier,
        diagnostics: profile.diagnostics,
      },
    });
  }

  return profile;
}

export async function supplierLeverageProfile(
  rfq: MarketplaceRfq,
  supplierId: string,
  options?: SupplierLeverageOptions,
): Promise<SupplierLeverageProfile> {
  const bids = options?.bids ?? (await fetchBidsForRfq(rfq.id));
  const marketProfile = await marketplacePowerProfile(rfq, {
    bids,
    logEvent: false,
  });
  const supplierSignals = await loadSupplierLeverageSignals(supplierId);
  const hasActiveBid = bids.some(
    (bid) => bid.supplier_id === supplierId && bid.status !== "withdrawn",
  );

  const marketCoverageGap = clamp(
    1 -
      marketProfile.diagnostics.uniqueBiddingSuppliers /
        Math.max(marketProfile.diagnostics.estimatedQualifiedSuppliers, 1),
    0,
    1,
  );

  const scarcityImpact = clamp(
    marketProfile.supplyDemand.reduce((max, signal) => {
      const ratio = signal.demand / Math.max(signal.supply, 1);
      return Math.max(max, ratio);
    }, 0) / 2,
    0,
    1,
  );

  const participationBenefit = hasActiveBid ? 0.1 : 0.25;
  const leverageScore = clamp(
    scarcityImpact * 0.45 +
      marketCoverageGap * 0.3 +
      supplierSignals.winRate * 0.2 +
      participationBenefit,
    0,
    1,
  );

  const posture =
    leverageScore >= 0.7
      ? "price_setter"
      : leverageScore <= 0.35
        ? "price_taker"
        : "balanced";

  const profile: SupplierLeverageProfile = {
    rfqId: rfq.id,
    supplierId,
    leverageScore,
    posture,
    supplierCompetitiveness: marketProfile.supplierCompetitiveness,
    responsePressure: marketProfile.responsePressure,
    customerPriorityTier: marketProfile.customerPriorityTier,
    supplyDemand: marketProfile.supplyDemand,
    reasoning: {
      scarcityImpact,
      marketCoverageGap,
      winRate: supplierSignals.winRate,
      totalBids: supplierSignals.totalBids,
      hasActiveBid,
    },
  };

  if (options?.logEvent !== false) {
    await logMarketplaceEvent({
      rfqId: rfq.id,
      supplierId,
      actorId: supplierId,
      type: "supplier_advantage_shifted",
      payload: {
        leverage_score: leverageScore,
        posture,
        scarcity_index: scarcityImpact,
        market_coverage_gap: marketCoverageGap,
        win_rate: supplierSignals.winRate,
        total_bids: supplierSignals.totalBids,
        has_active_bid: hasActiveBid,
      },
    });
  }

  return profile;
}

export async function customerPriorityProfile(
  rfq: MarketplaceRfq,
): Promise<CustomerPriorityProfile> {
  const history = await loadCustomerHistory(rfq.customer_id);
  const declaredPriority = normalizePriority(rfq.priority);
  const urgency = computeDateUrgency(rfq.target_date);
  const loyalty = clamp(history.totalRfqs / 10, 0, 1);
  const valueDensity = clamp(history.totalSpend / 50_000, 0, 1);
  const awardMomentum =
    history.totalRfqs > 0 ? clamp(history.awards / history.totalRfqs, 0, 1) : 0;

  const score = clamp(
    declaredPriority * 0.4 +
      urgency * 0.2 +
      loyalty * 0.15 +
      valueDensity * 0.2 +
      awardMomentum * 0.05,
    0,
    1,
  );

  const tier: CustomerPriorityTier =
    score >= 0.85
      ? "critical"
      : score >= 0.65
        ? "expedited"
        : score >= 0.35
          ? "standard"
          : "deferred";

  return {
    rfqId: rfq.id,
    customerId: rfq.customer_id ?? null,
    tier,
    score,
    drivers: {
      declaredPriority,
      urgency,
      loyalty,
      valueDensity,
      awardMomentum,
    },
  };
}

async function fetchBidsForRfq(rfqId: string): Promise<RfqBidRecord[]> {
  if (!rfqId || !isRfqsFeatureEnabled()) {
    return [];
  }

  try {
    const { data, error } = await supabaseServer
      .from("rfq_bids")
      .select(
        "id,rfq_id,supplier_id,price_total,currency,lead_time_days,notes,status,created_at,updated_at",
      )
      .eq("rfq_id", rfqId)
      .order("created_at", { ascending: true });

    if (error) {
      if (isMissingRfqTableError(error)) {
        return [];
      }
      console.error("strategy: failed to load bids", { rfqId, error });
      return [];
    }

    return (data as RfqBidRecord[]) ?? [];
  } catch (error) {
    if (isMissingRfqTableError(error)) {
      return [];
    }
    console.error("strategy: unexpected bid fetch error", { rfqId, error });
    return [];
  }
}

async function estimateProcessSupply(processes: string[]) {
  const normalized = [...new Set(processes.map((item) => item.trim()))];
  if (normalized.length === 0) {
    return {
      perProcessSupply: { [GENERAL_PROCESS]: await countSuppliers() },
      totalUniqueSuppliers: await countSuppliers(),
    };
  }

  const perProcessSupply: Record<string, number> = {};
  const union = new Set<string>();

  await Promise.all(
    normalized.map(async (process) => {
      try {
        const { data, error } = await supabaseServer
          .from("supplier_capabilities")
          .select("supplier_id,process")
          .ilike("process", `%${process}%`);

        if (error) {
          console.error("strategy: supply query failed", { process, error });
          perProcessSupply[process] = 0;
          return;
        }

        const rows =
          (data as Array<{ supplier_id: string | null; process: string | null }>) ??
          [];
        const suppliers = new Set<string>();
        rows.forEach((row) => {
          if (row?.supplier_id) {
            suppliers.add(row.supplier_id);
            union.add(row.supplier_id);
          }
        });
        perProcessSupply[process] = suppliers.size;
      } catch (error) {
        console.error("strategy: supply query unexpected error", { process, error });
        perProcessSupply[process] = 0;
      }
    }),
  );

  return {
    perProcessSupply,
    totalUniqueSuppliers: union.size,
  };
}

async function fetchProcessDemand(processes: string[]) {
  const normalized = [...new Set(processes.map((item) => item.trim()))];
  const demand: Record<string, number> = {};
  normalized.forEach((process) => {
    demand[process] = 0;
  });

  if (!isRfqsFeatureEnabled()) {
    return demand;
  }

  try {
    const { data, error } = await supabaseServer
      .from("rfqs")
      .select("id,process_requirements")
      .in("status", OPEN_RFQ_STATUSES)
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      if (isMissingRfqTableError(error)) {
        return demand;
      }
      console.error("strategy: demand query failed", { error });
      return demand;
    }

    const rows =
      (data as Array<{ process_requirements: string[] | null }>) ?? [];
    rows.forEach((row) => {
      const reqs = normalizeProcessArray(row.process_requirements);
      normalized.forEach((process) => {
        if (reqs.includes(process)) {
          demand[process] = (demand[process] ?? 0) + 1;
        }
      });
    });

    return demand;
  } catch (error) {
    if (isMissingRfqTableError(error)) {
      return demand;
    }
    console.error("strategy: demand query unexpected error", { error });
    return demand;
  }
}

async function countSuppliers(): Promise<number> {
  try {
    const { count, error } = await supabaseServer
      .from("suppliers")
      .select("id", { count: "exact", head: true });

    if (error) {
      console.error("strategy: supplier count failed", { error });
      return 0;
    }

    return count ?? 0;
  } catch (error) {
    console.error("strategy: supplier count unexpected error", { error });
    return 0;
  }
}

type SupplierSignals = {
  totalBids: number;
  awards: number;
  winRate: number;
  lastActivityAt: string | null;
};

async function loadSupplierLeverageSignals(supplierId: string): Promise<SupplierSignals> {
  if (!supplierId || !isRfqsFeatureEnabled()) {
    return { totalBids: 0, awards: 0, winRate: 0, lastActivityAt: null };
  }

  try {
    const { data, error } = await supabaseServer
      .from("rfq_bids")
      .select("status,updated_at,created_at")
      .eq("supplier_id", supplierId)
      .order("updated_at", { ascending: false })
      .limit(200);

    if (error) {
      if (isMissingRfqTableError(error)) {
        return { totalBids: 0, awards: 0, winRate: 0, lastActivityAt: null };
      }
      console.error("strategy: supplier leverage query failed", { supplierId, error });
      return { totalBids: 0, awards: 0, winRate: 0, lastActivityAt: null };
    }

    let totalBids = 0;
    let awards = 0;
    let lastActivityAt: string | null = null;

    const rows =
      (data as Array<{ status: string | null; updated_at: string | null; created_at: string | null }>) ??
      [];

    rows.forEach((row) => {
      if (!row) {
        return;
      }
      totalBids += 1;
      if (row.status === "accepted") {
        awards += 1;
      }
      const timestamp = row.updated_at ?? row.created_at ?? null;
      if (timestamp && (!lastActivityAt || timestamp > lastActivityAt)) {
        lastActivityAt = timestamp;
      }
    });

    const winRate = totalBids > 0 ? awards / totalBids : 0;

    return {
      totalBids,
      awards,
      winRate,
      lastActivityAt,
    };
  } catch (error) {
    if (isMissingRfqTableError(error)) {
      return { totalBids: 0, awards: 0, winRate: 0, lastActivityAt: null };
    }
    console.error("strategy: supplier leverage unexpected error", { supplierId, error });
    return { totalBids: 0, awards: 0, winRate: 0, lastActivityAt: null };
  }
}

type CustomerHistory = {
  totalRfqs: number;
  awards: number;
  totalSpend: number;
};

async function loadCustomerHistory(customerId: string | null): Promise<CustomerHistory> {
  if (!customerId || !isRfqsFeatureEnabled()) {
    return { totalRfqs: 0, awards: 0, totalSpend: 0 };
  }

  try {
    const { data, error } = await supabaseServer
      .from("rfqs")
      .select("id,status,priority")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      if (isMissingRfqTableError(error)) {
        return { totalRfqs: 0, awards: 0, totalSpend: 0 };
      }
      console.error("strategy: customer history query failed", { customerId, error });
      return { totalRfqs: 0, awards: 0, totalSpend: 0 };
    }

    const rows =
      (data as Array<{ id: string; status: string | null; priority: number | null }>) ??
      [];

    const rfqIds = rows.map((row) => row.id);
    const totalRfqs = rows.length;
    const awards = rows.filter((row) => row.status === "awarded").length;

    let totalSpend = 0;
    if (rfqIds.length > 0) {
      const { data: awardedBids, error: spendError } = await supabaseServer
        .from("rfq_bids")
        .select("price_total,rfq_id")
        .in("rfq_id", rfqIds)
        .eq("status", "accepted");

      if (spendError) {
        if (!isMissingRfqTableError(spendError)) {
          console.error("strategy: spend lookup failed", { customerId, error: spendError });
        }
      } else {
        (awardedBids as Array<{ price_total: number | string | null }> | null)?.forEach(
          (row) => {
            const value =
              typeof row.price_total === "string"
                ? Number.parseFloat(row.price_total)
                : row.price_total;
            if (Number.isFinite(value ?? NaN)) {
              totalSpend += value ?? 0;
            }
          },
        );
      }
    }

    return { totalRfqs, awards, totalSpend };
  } catch (error) {
    if (isMissingRfqTableError(error)) {
      return { totalRfqs: 0, awards: 0, totalSpend: 0 };
    }
    console.error("strategy: customer history unexpected error", { customerId, error });
    return { totalRfqs: 0, awards: 0, totalSpend: 0 };
  }
}

function normalizeProcessArray(values?: string[] | null): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }
  return values
    .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
    .filter((value) => value.length > 0);
}

function computeResponsePressure(args: {
  rfq: MarketplaceRfq;
  scarcityIndex: number;
  coverage: number;
  bidCount: number;
}): ResponsePressure {
  const now = Date.now();
  const createdAt = Date.parse(args.rfq.created_at ?? "");
  const daysOpen =
    Number.isFinite(createdAt) && createdAt > 0
      ? Math.max((now - createdAt) / DAY_MS, 0)
      : 0;
  const targetDate = args.rfq.target_date ? Date.parse(args.rfq.target_date) : NaN;

  const urgency = Number.isFinite(targetDate)
    ? clamp(1 - (targetDate - now) / (14 * DAY_MS), 0, 1)
    : clamp(daysOpen / 30, 0, 1);

  const scarcityPressure = clamp(args.scarcityIndex / 2, 0, 1);
  const bidCoveragePressure = clamp(1 - args.coverage, 0, 1);
  const stalePressure = clamp(daysOpen / 60, 0, 0.25);

  const index = clamp(
    urgency * 0.45 + scarcityPressure * 0.35 + bidCoveragePressure * 0.2 + stalePressure,
    0,
    1,
  );
  const level = index >= 0.7 ? "high" : index >= 0.4 ? "medium" : "low";

  const drivers: string[] = [];
  if (urgency > 0.6) {
    drivers.push("target_window_closing");
  }
  if (scarcityPressure > 0.5) {
    drivers.push("supply_shortage");
  }
  if (bidCoveragePressure > 0.5) {
    drivers.push("limited_bids");
  }
  if (drivers.length === 0) {
    drivers.push("stable");
  }

  return { level, index, drivers };
}

function computeDateUrgency(targetDate?: string | null) {
  if (!targetDate) {
    return 0.3;
  }
  const timestamp = Date.parse(targetDate);
  if (!Number.isFinite(timestamp)) {
    return 0.3;
  }
  const days = (timestamp - Date.now()) / DAY_MS;
  if (days <= 0) {
    return 1;
  }
  if (days <= 7) {
    return 0.85;
  }
  if (days <= 14) {
    return 0.6;
  }
  if (days <= 30) {
    return 0.4;
  }
  return 0.2;
}

function normalizePriority(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0.3;
  }
  if (value > 1 && value <= 100) {
    return clamp(value / 100, 0, 1);
  }
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
