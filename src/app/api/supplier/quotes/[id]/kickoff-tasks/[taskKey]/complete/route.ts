import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabaseServer";
import { requireUser, UnauthorizedError } from "@/server/auth";
import { loadSupplierProfileByUserId } from "@/server/suppliers";
import { assertSupplierQuoteAccess } from "@/server/quotes/access";
import { DEFAULT_SUPPLIER_KICKOFF_TASKS } from "@/lib/quote/kickoffChecklist";
import { emitQuoteEvent } from "@/server/quotes/events";
import { finalizeKickoffCompletionIfComplete } from "@/server/quotes/kickoffCompletion";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { schemaGate } from "@/server/db/schemaContract";
import { getDemoSupplierProviderIdFromCookie } from "@/server/demo/demoSupplierProvider";

const LOG_PREFIX = "[supplier kickoff tasks api]";
const SUPPLIER_KICKOFF_TASKS_TABLE_LEGACY = "quote_kickoff_tasks";
const SUPPLIER_KICKOFF_TASKS_TABLE_RENAMED = "quote_supplier_kickoff_tasks";

async function resolveSupplierKickoffTasksTableName(): Promise<string> {
  // Keep permissive: some environments store completion via `completed_at` and may
  // make `completed` generated (or omit it).
  const requiredColumns = ["quote_id", "supplier_id", "task_key", "title"];
  const legacyOk = await schemaGate({
    enabled: true,
    relation: SUPPLIER_KICKOFF_TASKS_TABLE_LEGACY,
    requiredColumns,
    warnPrefix: LOG_PREFIX,
    warnKey: "supplier_kickoff_api:legacy_schema",
  });
  if (legacyOk) return SUPPLIER_KICKOFF_TASKS_TABLE_LEGACY;

  const renamedOk = await schemaGate({
    enabled: true,
    relation: SUPPLIER_KICKOFF_TASKS_TABLE_RENAMED,
    requiredColumns,
    warnPrefix: LOG_PREFIX,
    warnKey: "supplier_kickoff_api:renamed_schema",
  });
  if (renamedOk) return SUPPLIER_KICKOFF_TASKS_TABLE_RENAMED;

  return SUPPLIER_KICKOFF_TASKS_TABLE_LEGACY;
}

export async function POST(
  _req: Request,
  context: { params: Promise<{ id?: string; taskKey?: string }> },
) {
  const params = await context.params;
  const quoteId = typeof params?.id === "string" ? params.id.trim() : "";
  const taskKey = normalizeTaskKey(params?.taskKey);

  try {
    const user = await requireUser();

    if (!isUuidLike(quoteId) || !taskKey) {
      return NextResponse.json(
        { ok: false, error: "invalid_input" },
        { status: 400 },
      );
    }

    const profile = await loadSupplierProfileByUserId(user.id);
    const supplierId =
      typeof profile?.supplier?.id === "string" ? profile.supplier.id.trim() : "";
    const supplierProviderId =
      typeof (profile?.supplier as { provider_id?: string | null } | null)?.provider_id ===
      "string"
        ? (profile?.supplier as any).provider_id.trim()
        : null;
    const demoProviderId = await getDemoSupplierProviderIdFromCookie();
    const effectiveProviderId = demoProviderId ?? supplierProviderId;

    if (!isUuidLike(supplierId)) {
      return NextResponse.json(
        { ok: false, error: "missing_supplier_profile" },
        { status: 403 },
      );
    }

    const access = await assertSupplierQuoteAccess({
      quoteId,
      supplierId,
      supplierUserEmail: user.email ?? null,
      supplierProviderId: effectiveProviderId,
    });
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const { data: quoteRow, error: quoteError } = await supabaseServer()
      .from("quotes")
      .select("id,awarded_supplier_id")
      .eq("id", quoteId)
      .maybeSingle<{ id: string; awarded_supplier_id: string | null }>();

    if (quoteError) {
      console.error(`${LOG_PREFIX} quote lookup failed`, {
        quoteId,
        error: serializeSupabaseError(quoteError),
      });
      return NextResponse.json(
        { ok: false, error: "quote_lookup_failed" },
        { status: 500 },
      );
    }

    const awardedSupplierId =
      typeof quoteRow?.awarded_supplier_id === "string"
        ? quoteRow.awarded_supplier_id.trim()
        : "";
    if (demoProviderId) {
      // Demo-only: winner is determined by `rfq_awards.provider_id === cookieProviderId`.
      const rfqAwardsReady = await schemaGate({
        enabled: true,
        relation: "rfq_awards",
        requiredColumns: ["rfq_id", "provider_id"],
        warnPrefix: LOG_PREFIX,
        warnKey: "supplier_kickoff_api:rfq_awards_schema",
      });
      if (!rfqAwardsReady) {
        return NextResponse.json(
          { ok: false, error: "not_awarded_supplier" },
          { status: 403 },
        );
      }
      const { data: awardRow } = await supabaseServer()
        .from("rfq_awards")
        .select("provider_id")
        .eq("rfq_id", quoteId)
        .maybeSingle<{ provider_id: string | null }>();
      const awardedProviderId =
        typeof awardRow?.provider_id === "string" ? awardRow.provider_id.trim() : "";
      if (!awardedProviderId || awardedProviderId !== demoProviderId) {
        return NextResponse.json(
          { ok: false, error: "not_awarded_supplier" },
          { status: 403 },
        );
      }
    } else if (!awardedSupplierId || awardedSupplierId !== supplierId) {
      // Offer-award fallback: some environments award via `rfq_awards.provider_id` only.
      if (effectiveProviderId) {
        const rfqAwardsReady = await schemaGate({
          enabled: true,
          relation: "rfq_awards",
          requiredColumns: ["rfq_id", "provider_id"],
          warnPrefix: LOG_PREFIX,
          warnKey: "supplier_kickoff_api:rfq_awards_schema",
        });
        if (rfqAwardsReady) {
          const { data: awardRow } = await supabaseServer()
            .from("rfq_awards")
            .select("provider_id")
            .eq("rfq_id", quoteId)
            .maybeSingle<{ provider_id: string | null }>();
          const awardedProviderId =
            typeof awardRow?.provider_id === "string" ? awardRow.provider_id.trim() : "";
          if (!awardedProviderId || awardedProviderId !== effectiveProviderId) {
            return NextResponse.json(
              { ok: false, error: "not_awarded_supplier" },
              { status: 403 },
            );
          }
        } else {
          return NextResponse.json(
            { ok: false, error: "not_awarded_supplier" },
            { status: 403 },
          );
        }
      } else {
        return NextResponse.json(
          { ok: false, error: "not_awarded_supplier" },
          { status: 403 },
        );
      }
    }

    const definition =
      DEFAULT_SUPPLIER_KICKOFF_TASKS.find((t) => t.taskKey === taskKey) ?? null;

    const now = new Date().toISOString();
    const supplierTasksTable = await resolveSupplierKickoffTasksTableName();

    const updateWithCompletedAtOnly = async () =>
      supabaseServer()
        .from(supplierTasksTable)
        .update({
          completed_at: now,
          completed_by_user_id: user.id,
          completed_by_role: "supplier",
        })
        .eq("quote_id", quoteId)
        .eq("supplier_id", supplierId)
        .eq("task_key", taskKey)
        .select("id")
        .returns<{ id: string }[]>();

    const updateWithCompletedBool = async () =>
      supabaseServer()
        .from(supplierTasksTable)
        .update({ completed: true })
        .eq("quote_id", quoteId)
        .eq("supplier_id", supplierId)
        .eq("task_key", taskKey)
        .select("id")
        .returns<{ id: string }[]>();

    const updatedAttempt = await updateWithCompletedAtOnly();
    let updatedRows = updatedAttempt.data ?? [];
    let updateError = updatedAttempt.error;

    if (updateError && isMissingTableOrColumnError(updateError)) {
      const fallback = await updateWithCompletedBool();
      updatedRows = fallback.data ?? [];
      updateError = fallback.error;
    }

    if (updateError) {
      if (isMissingTableOrColumnError(updateError)) {
        console.warn(`${LOG_PREFIX} kickoff tasks missing schema`, {
          quoteId,
          supplierId,
          error: serializeSupabaseError(updateError),
        });
        return NextResponse.json(
          { ok: false, error: "kickoff_tasks_unavailable" },
          { status: 200 },
        );
      }
      console.error(`${LOG_PREFIX} kickoff task update failed`, {
        quoteId,
        supplierId,
        taskKey,
        error: serializeSupabaseError(updateError),
      });
      return NextResponse.json(
        { ok: false, error: "update_failed" },
        { status: 500 },
      );
    }

    const updatedCount = Array.isArray(updatedRows) ? updatedRows.length : 0;
    if (updatedCount === 0) {
      const insertBase = {
        quote_id: quoteId,
        supplier_id: supplierId,
        task_key: taskKey,
        title: definition?.title ?? taskKey,
        description: definition?.description ?? null,
        sort_order: definition?.sortOrder ?? null,
      };

      const insertWithCompletedAtOnly = async () =>
        supabaseServer().from(supplierTasksTable).insert({
          ...insertBase,
          completed_at: now,
          completed_by_user_id: user.id,
          completed_by_role: "supplier",
        });

      const insertWithCompletedBool = async () =>
        supabaseServer().from(supplierTasksTable).insert({ ...insertBase, completed: true });

      const insertAttempt = await insertWithCompletedAtOnly();
      let insertError = insertAttempt.error;
      if (insertError && isMissingTableOrColumnError(insertError)) {
        const fallback = await insertWithCompletedBool();
        insertError = fallback.error;
      }

      if (insertError) {
        if (isMissingTableOrColumnError(insertError)) {
          console.warn(`${LOG_PREFIX} kickoff tasks missing schema`, {
            quoteId,
            supplierId,
            error: serializeSupabaseError(insertError),
          });
          return NextResponse.json(
            { ok: false, error: "kickoff_tasks_unavailable" },
            { status: 200 },
          );
        }
        console.error(`${LOG_PREFIX} kickoff task insert failed`, {
          quoteId,
          supplierId,
          taskKey,
          error: serializeSupabaseError(insertError),
        });
        return NextResponse.json(
          { ok: false, error: "insert_failed" },
          { status: 500 },
        );
      }
    }

    // Emit an admin/supplier-visible timeline entry (customer visibility can be enabled later).
    void emitQuoteEvent({
      quoteId,
      eventType: "kickoff_task_completed",
      actorRole: "supplier",
      actorUserId: user.id,
      actorSupplierId: supplierId,
      metadata: { taskKey, supplier_id: supplierId },
      createdAt: now,
    });

    // Best-effort: stamp quote kickoff completion once all tasks are complete.
    void finalizeKickoffCompletionIfComplete({
      quoteId,
      supplierId,
      actorUserId: user.id,
      actorRole: "supplier",
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    console.error(`${LOG_PREFIX} crashed`, {
      quoteId: quoteId || null,
      taskKey: taskKey || null,
      error: serializeSupabaseError(error) ?? error,
    });
    return NextResponse.json({ ok: false, error: "unknown" }, { status: 500 });
  }
}

function normalizeTaskKey(value: unknown): string {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  return key.replace(/[^a-z0-9_-]/gi, "");
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

