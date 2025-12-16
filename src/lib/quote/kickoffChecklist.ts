// The checklist definition itself is shared by server and client modules.
// Keep this file free of server-only dependencies so it can be imported anywhere.

export type KickoffChecklistTaskDefinition = {
  taskKey: string;
  title: string;
  description: string;
  sortOrder: number;
};

export type SupplierKickoffTask = {
  id: string | null;
  taskKey: string;
  title: string;
  description: string | null;
  completed: boolean;
  sortOrder: number | null;
  updatedAt: string | null;
};

export type KickoffTasksSummaryStatus =
  | "not-started"
  | "in-progress"
  | "complete";

export type KickoffTasksSummary = {
  status: KickoffTasksSummaryStatus;
  completedCount: number;
  totalCount: number;
  lastUpdatedAt: string | null;
};

export const DEFAULT_SUPPLIER_KICKOFF_TASKS: KickoffChecklistTaskDefinition[] = [
  {
    taskKey: "review-rfq",
    title: "Review the RFQ and final drawings",
    description:
      "Double-check geometry, tolerances, and any redlines before cutting chips.",
    sortOrder: 1,
  },
  {
    taskKey: "confirm-material",
    title: "Confirm material and finishing plan",
    description:
      "Lock in stock availability, finishing partners, and any outside processes.",
    sortOrder: 2,
  },
  {
    taskKey: "confirm-start-date",
    title: "Confirm your internal start date",
    description:
      "Align with programming and machine scheduling so we can communicate a firm kickoff.",
    sortOrder: 3,
  },
  {
    taskKey: "acknowledge-delivery",
    title: "Acknowledge the delivery window and ship method",
    description:
      "Make sure packaging, transit time, and carrier preferences are locked down.",
    sortOrder: 4,
  },
  {
    taskKey: "share-dfm-clarifications",
    title: "Share any DFM clarifications or open questions",
    description:
      "Tell us about tooling tweaks, risk areas, or anything the customer should know before PO release.",
    sortOrder: 5,
  },
];

export function buildDefaultSupplierKickoffTasks(): SupplierKickoffTask[] {
  return DEFAULT_SUPPLIER_KICKOFF_TASKS.map((task) => ({
    ...task,
    id: null,
    completed: false,
    updatedAt: null,
  }));
}

export function mergeKickoffTasksWithDefaults(
  tasks: SupplierKickoffTask[] | null | undefined,
): SupplierKickoffTask[] {
  const provided =
    (tasks ?? [])
      .filter((task): task is SupplierKickoffTask => Boolean(task?.taskKey))
      .map((task) => normalizeTask(task)) ?? [];

  const providedMap = new Map(
    provided.map((task) => [task.taskKey, task]),
  );

  const merged: SupplierKickoffTask[] = [];

  for (const definition of DEFAULT_SUPPLIER_KICKOFF_TASKS) {
    const existing = providedMap.get(definition.taskKey);
    if (existing) {
      merged.push({
        ...definition,
        ...existing,
        title: existing.title || definition.title,
        description: existing.description ?? definition.description,
        sortOrder: existing.sortOrder ?? definition.sortOrder,
      });
      providedMap.delete(definition.taskKey);
    } else {
      merged.push({
        ...definition,
        id: null,
        completed: false,
        updatedAt: null,
      });
    }
  }

  const remaining = Array.from(providedMap.values()).sort(
    (a, b) => getSortValue(a.sortOrder) - getSortValue(b.sortOrder),
  );

  return [...merged, ...remaining].sort(
    (a, b) => getSortValue(a.sortOrder) - getSortValue(b.sortOrder),
  );
}

export function summarizeKickoffTasks(
  tasks: SupplierKickoffTask[] | null | undefined,
): KickoffTasksSummary {
  const merged = mergeKickoffTasksWithDefaults(tasks);
  const totalCount = merged.length;
  const completedCount = merged.filter((task) => task.completed).length;
  const lastUpdatedAt = getLatestUpdatedAt(merged);

  let status: KickoffTasksSummaryStatus = "not-started";

  if (totalCount === 0 || completedCount === 0) {
    status = "not-started";
  } else if (completedCount >= totalCount) {
    status = "complete";
  } else {
    status = "in-progress";
  }

  return {
    status,
    completedCount,
    totalCount,
    lastUpdatedAt,
  };
}

export function formatKickoffSummaryLabel(
  summary: KickoffTasksSummary | null,
): string {
  if (!summary) {
    return "Kickoff checklist unavailable";
  }
  if (summary.totalCount === 0) {
    return "Kickoff not started";
  }
  if (summary.status === "complete") {
    return "Kickoff complete";
  }
  if (summary.status === "in-progress") {
    return `In progress (${summary.completedCount} of ${summary.totalCount} tasks complete)`;
  }
  return "Kickoff not started";
}

export type KickoffProgressBasis = {
  /**
   * True when `quotes.kickoff_completed_at` is set (authoritative), or when counts
   * indicate all tasks are complete as a fallback.
   */
  isComplete: boolean;
  completedCount: number | null;
  totalCount: number | null;
};

export function resolveKickoffProgressBasis(args: {
  kickoffCompletedAt?: string | null;
  completedCount?: number | null;
  totalCount?: number | null;
}): KickoffProgressBasis {
  const kickoffCompletedAt =
    typeof args.kickoffCompletedAt === "string" ? args.kickoffCompletedAt.trim() : "";
  const completedCount =
    typeof args.completedCount === "number" && Number.isFinite(args.completedCount)
      ? args.completedCount
      : null;
  const totalCount =
    typeof args.totalCount === "number" && Number.isFinite(args.totalCount)
      ? args.totalCount
      : null;

  const completeFromCounts =
    totalCount !== null &&
    totalCount > 0 &&
    completedCount !== null &&
    completedCount >= totalCount;

  return {
    isComplete: kickoffCompletedAt.length > 0 || completeFromCounts,
    completedCount,
    totalCount,
  };
}

export function formatKickoffTasksRatio(progress: {
  completedCount: number | null;
  totalCount: number | null;
}): string | null {
  if (
    typeof progress.completedCount === "number" &&
    typeof progress.totalCount === "number" &&
    Number.isFinite(progress.completedCount) &&
    Number.isFinite(progress.totalCount) &&
    progress.totalCount > 0
  ) {
    return `${progress.completedCount}/${progress.totalCount}`;
  }
  return null;
}

function normalizeTask(task: SupplierKickoffTask): SupplierKickoffTask {
  const taskKey = typeof task.taskKey === "string" ? task.taskKey.trim() : "";
  return {
    id: typeof task.id === "string" ? task.id : null,
    taskKey,
    title:
      typeof task.title === "string" && task.title.trim().length > 0
        ? task.title.trim()
        : taskKey || "Kickoff task",
    description:
      typeof task.description === "string" && task.description.trim().length > 0
        ? task.description.trim()
        : null,
    completed: Boolean(task.completed),
    sortOrder:
      typeof task.sortOrder === "number" && Number.isFinite(task.sortOrder)
        ? task.sortOrder
        : null,
    updatedAt:
      typeof task.updatedAt === "string" && task.updatedAt.trim().length > 0
        ? task.updatedAt
        : null,
  };
}

function getSortValue(value?: number | null): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return Number.MAX_SAFE_INTEGER;
}

function getLatestUpdatedAt(tasks: SupplierKickoffTask[]): string | null {
  let bestTimestamp: number | null = null;
  let bestIso: string | null = null;

  for (const task of tasks) {
    const updatedAt = typeof task.updatedAt === "string" ? task.updatedAt.trim() : "";
    if (!updatedAt) {
      continue;
    }
    const timestamp = Date.parse(updatedAt);
    if (!Number.isFinite(timestamp)) {
      continue;
    }
    if (bestTimestamp === null || timestamp > bestTimestamp) {
      bestTimestamp = timestamp;
      bestIso = updatedAt;
    }
  }

  return bestIso;
}
