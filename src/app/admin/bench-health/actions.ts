"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getFormString, serializeActionError } from "@/lib/forms";
import { requireAdminUser } from "@/server/auth";
import {
  createBenchGapTask,
  updateBenchGapTaskStatus,
  type BenchGapTaskStatus,
} from "@/server/admin/benchGapTasks";
import { logBenchGapTaskOpsEvent } from "@/server/ops/events";

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function createBenchGapTaskAction(formData: FormData): Promise<void> {
  const dimension = normalizeOptionalText(getFormString(formData, "dimension"));
  const key = normalizeOptionalText(getFormString(formData, "key"));
  const window = normalizeOptionalText(getFormString(formData, "window"));

  if (!dimension || !key || !window) return;

  try {
    const user = await requireAdminUser();
    const result = await createBenchGapTask({
      dimension: dimension as any,
      key,
      window,
      owner: user.email ?? null,
    });

    if (result.ok) {
      await logBenchGapTaskOpsEvent({
        gapTaskId: result.task.id,
        action: "task_created",
        dimension: result.task.dimension,
        key: result.task.key,
        window: result.task.window,
        context: { source: "admin_bench_health" },
      });
    }

    revalidatePath("/admin/bench-health");
    revalidatePath("/admin/bench-health/tasks");
  } catch (error) {
    console.error("[bench gap tasks] create action crashed", {
      dimension,
      key,
      window,
      error: serializeActionError(error),
    });
  }
}

export async function updateBenchGapTaskStatusAction(formData: FormData): Promise<void> {
  const taskId = normalizeId(getFormString(formData, "taskId"));
  const status = normalizeOptionalText(getFormString(formData, "status")) as BenchGapTaskStatus | null;
  const dimension = normalizeOptionalText(getFormString(formData, "dimension"));
  const key = normalizeOptionalText(getFormString(formData, "key"));
  const window = normalizeOptionalText(getFormString(formData, "window"));

  if (!taskId || !status) return;

  try {
    const result = await updateBenchGapTaskStatus({ id: taskId, status });
    if (result.ok) {
      await logBenchGapTaskOpsEvent({
        gapTaskId: result.task.id,
        action: "status_changed",
        dimension: result.task.dimension,
        key: result.task.key,
        window: result.task.window,
        context: { source: "admin_bench_health_tasks", next_status: result.task.status },
      });
    } else if (taskId) {
      // Best-effort: still record the intent, even if status update failed.
      await logBenchGapTaskOpsEvent({
        gapTaskId: taskId,
        action: "status_changed",
        dimension,
        key,
        window,
        context: { source: "admin_bench_health_tasks", next_status: status, result: "failed" },
      });
    }

    revalidatePath("/admin/bench-health");
    revalidatePath("/admin/bench-health/tasks");
  } catch (error) {
    console.error("[bench gap tasks] status action crashed", {
      taskId,
      status,
      error: serializeActionError(error),
    });
  }
}

export async function discoverSuppliersFromGapTaskAction(formData: FormData): Promise<void> {
  const href = normalizeOptionalText(getFormString(formData, "href"));
  const gapTaskId = normalizeId(getFormString(formData, "gapTaskId"));
  const dimension = normalizeOptionalText(getFormString(formData, "dimension"));
  const key = normalizeOptionalText(getFormString(formData, "key"));
  const window = normalizeOptionalText(getFormString(formData, "window"));

  if (!href) return;

  try {
    await requireAdminUser();

    if (gapTaskId) {
      await logBenchGapTaskOpsEvent({
        gapTaskId,
        action: "discover_suppliers_clicked",
        dimension,
        key,
        window,
        href,
        context: { source: "admin_bench_health" },
      });
    }
  } catch (error) {
    // Best-effort by design.
    console.warn("[bench gap tasks] discover suppliers log failed", {
      gapTaskId,
      href,
      error: serializeActionError(error),
    });
  }

  redirect(href);
}

