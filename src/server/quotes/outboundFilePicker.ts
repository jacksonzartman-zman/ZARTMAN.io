import { supabaseServer } from "@/lib/supabaseServer";
import { schemaGate, hasColumns } from "@/server/db/schemaContract";
import { isMissingTableOrColumnError, isSupabaseRelationMarkedMissing, warnOnce } from "@/server/db/schemaErrors";

export type OutboundFileOption = {
  id: string;
  filename: string | null;
  createdAt: string | null;
  sizeBytes: number | null;
  mime: string | null;
};

const WARN_PREFIX = "[file_picker]";

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clampLimit(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value <= 0) return fallback;
  return Math.max(1, Math.min(200, Math.floor(value)));
}

type CandidateRelation = "files_valid_compat" | "files_valid" | "files";

async function tryLoadFromRelation(args: {
  relation: CandidateRelation;
  quoteId: string;
  limit: number;
}): Promise<OutboundFileOption[] | null> {
  if (isSupabaseRelationMarkedMissing(args.relation)) {
    return null;
  }

  const supported = await schemaGate({
    enabled: true,
    relation: args.relation,
    requiredColumns: ["id", "quote_id"],
    warnPrefix: WARN_PREFIX,
    warnKey: `file_picker:${args.relation}:base`,
  });
  if (!supported) return null;

  // Optional columns are included only when present to avoid schema drift spam.
  const [hasFilename, hasCreatedAt, hasSizeBytes, hasMime] = await Promise.all([
    hasColumns(args.relation, ["filename"]),
    hasColumns(args.relation, ["created_at"]),
    hasColumns(args.relation, ["size_bytes"]),
    hasColumns(args.relation, ["mime"]),
  ]);

  const selectParts = ["id"];
  if (hasFilename) selectParts.push("filename");
  if (hasCreatedAt) selectParts.push("created_at");
  if (hasSizeBytes) selectParts.push("size_bytes");
  if (hasMime) selectParts.push("mime");
  const select = selectParts.join(",");

  const run = async (orderBy: "created_at" | "id") => {
    let q = supabaseServer().from(args.relation).select(select).eq("quote_id", args.quoteId) as any;
    q = q.order(orderBy, { ascending: false }).limit(args.limit);
    return (await q) as { data?: unknown; error?: unknown };
  };

  try {
    let result = await run(hasCreatedAt ? "created_at" : "id");
    if (result.error && isMissingTableOrColumnError(result.error)) {
      // Fall back to an order that is likely to exist across schema variants.
      result = await run("id");
    }
    if (result.error) {
      return [];
    }

    const rows = Array.isArray(result.data) ? (result.data as any[]) : [];
    return rows
      .map((row): OutboundFileOption | null => {
        const id = normalizeId(row?.id);
        if (!id) return null;
        return {
          id,
          filename: typeof row?.filename === "string" ? row.filename : null,
          createdAt: typeof row?.created_at === "string" ? row.created_at : null,
          sizeBytes: typeof row?.size_bytes === "number" ? row.size_bytes : null,
          mime: typeof row?.mime === "string" ? row.mime : null,
        };
      })
      .filter((row): row is OutboundFileOption => Boolean(row));
  } catch {
    return [];
  }
}

export async function loadOutboundFileOptions(args: {
  quoteId: string;
  limit?: number;
}): Promise<OutboundFileOption[]> {
  const quoteId = normalizeId(args.quoteId);
  if (!quoteId) return [];

  const limit = clampLimit(args.limit, 50);

  // Prefer the drift-tolerant view, then fall back.
  const relations: CandidateRelation[] = ["files_valid_compat", "files_valid", "files"];

  for (const relation of relations) {
    const result = await tryLoadFromRelation({ relation, quoteId, limit });
    if (result === null) continue;
    return result;
  }

  warnOnce("file_picker:unsupported", `${WARN_PREFIX} unsupported; skipping`, { quoteId });
  return [];
}

