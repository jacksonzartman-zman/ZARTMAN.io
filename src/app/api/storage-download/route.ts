import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getServerAuthUser, requireAdminUser } from "@/server/auth";
import { verifyPreviewTokenForUser } from "@/server/cadPreviewToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePath(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw.replace(/^\/+/, "");
}

function buildContentDisposition(disposition: "inline" | "attachment", filename: string | null): string {
  const safe = (filename ?? "").replace(/"/g, "").trim() || "file";
  return `${disposition}; filename="${safe}"`;
}

function basenameOfPath(path: string): string {
  const normalized = normalizePath(path);
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function getServiceSupabase():
  | { ok: true; client: SupabaseClient }
  | { ok: false; response: NextResponse } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || !serviceKey.trim()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "server_misconfigured: missing service role key" },
        { status: 500 },
      ),
    };
  }
  if (!url || !url.trim()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "server_misconfigured: missing NEXT_PUBLIC_SUPABASE_URL" },
        { status: 500 },
      ),
    };
  }
  return {
    ok: true,
    client: createClient(url, serviceKey, { auth: { persistSession: false } }),
  };
}

type CanonicalQuoteFileRow = {
  id: string;
  filename: string | null;
  storage_path?: string | null;
  bucket_id?: string | null;
};

async function resolveCanonicalStorageForQuoteFileId(
  supabase: SupabaseClient,
  quoteFileId: string,
): Promise<{ ok: true; bucket: string; path: string; filename: string | null } | { ok: false; reason: string }> {
  const qfid = normalizeId(quoteFileId);
  if (!qfid) return { ok: false, reason: "missing_quote_file_id" };

  const tryLoad = async (table: "files_valid" | "files"): Promise<CanonicalQuoteFileRow | null> => {
    try {
      const { data, error } = await supabase
        .from(table)
        .select("id,filename,storage_path,bucket_id")
        .eq("id", qfid)
        .maybeSingle<CanonicalQuoteFileRow>();
      if (error || !data?.id) return null;
      return data;
    } catch {
      return null;
    }
  };

  const row = (await tryLoad("files_valid")) ?? (await tryLoad("files"));
  if (!row?.id) return { ok: false, reason: "quote_file_not_found" };

  const bucket = normalizeId(row.bucket_id);
  const path = normalizePath(row.storage_path ?? "");
  if (!bucket || !path) return { ok: false, reason: "missing_storage_identity" };

  return { ok: true, bucket, path, filename: row.filename ?? null };
}

export async function GET(req: NextRequest) {
  const token = normalizeId(req.nextUrl.searchParams.get("token"));
  const bucketParam = normalizeId(req.nextUrl.searchParams.get("bucket"));
  const pathParam = normalizePath(req.nextUrl.searchParams.get("path"));
  const filenameParam = normalizeId(req.nextUrl.searchParams.get("filename")) || null;
  const dispositionRaw = normalizeId(req.nextUrl.searchParams.get("disposition"));
  const disposition: "inline" | "attachment" =
    dispositionRaw === "inline" ? "inline" : "attachment";

  const { user } = await getServerAuthUser();
  if (!user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = getServiceSupabase();
  if (!svc.ok) return svc.response;
  const supabase = svc.client;

  let bucket = bucketParam;
  let path = pathParam;
  let filename: string | null = filenameParam;

  if (token) {
    const verified = verifyPreviewTokenForUser({ token, userId: user.id });
    if (!verified.ok) {
      return NextResponse.json({ error: "invalid_token" }, { status: 401 });
    }

    if (verified.payload.v === 3) {
      const quoteFileId = normalizeId((verified.payload as any).quoteFileId ?? (verified.payload as any).qfid);
      const resolved = await resolveCanonicalStorageForQuoteFileId(supabase, quoteFileId);
      if (!resolved.ok) {
        return NextResponse.json({ error: "source_not_found" }, { status: 404 });
      }
      bucket = resolved.bucket;
      path = resolved.path;
      filename = filename ?? resolved.filename ?? null;
    } else {
      bucket = normalizeId((verified.payload as any).b);
      path = normalizePath((verified.payload as any).p);
    }
  } else {
    // Direct bucket/path downloads are admin-only.
    try {
      await requireAdminUser();
    } catch {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  if (!bucket || !path) {
    return NextResponse.json({ error: "missing_bucket_or_path" }, { status: 400 });
  }

  const safeName = filename ?? basenameOfPath(path) ?? "file";

  const { data: blob, error } = await supabase.storage.from(bucket).download(path);
  if (error || !blob) {
    return NextResponse.json({ error: "source_not_found" }, { status: 404 });
  }

  // Blob.type is best-effort; storage may return an empty content-type.
  const contentType =
    typeof (blob as any)?.type === "string" && (blob as any).type.trim()
      ? ((blob as any).type as string)
      : "application/octet-stream";

  return new NextResponse(blob.stream(), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": buildContentDisposition(disposition, safeName),
      "Cache-Control": "no-store",
    },
  });
}

