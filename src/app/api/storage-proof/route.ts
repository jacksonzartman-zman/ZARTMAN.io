import { NextResponse, type NextRequest } from "next/server";
import { getServerAuthUser } from "@/server/auth";

export const dynamic = "force-dynamic";

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePath(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw.replace(/^\/+/, "");
}

function encodeObjectPath(path: string): string {
  // Encode each segment so slashes remain path separators.
  return path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

export async function GET(req: NextRequest) {
  const { user } = await getServerAuthUser();
  if (!user?.id) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const bucket = normalizeId(req.nextUrl.searchParams.get("bucket"));
  const path = normalizePath(req.nextUrl.searchParams.get("path"));

  if (!bucket || !path) {
    return NextResponse.json(
      { ok: false, error: "missing_bucket_or_path" },
      { status: 400 },
    );
  }

  const allowedBucket =
    process.env.SUPABASE_CAD_BUCKET ||
    process.env.NEXT_PUBLIC_CAD_BUCKET ||
    process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
    "cad";

  // Safety: only allow proof checks for intake uploads in the CAD bucket.
  if (bucket !== allowedBucket) {
    return NextResponse.json(
      { ok: false, error: "bucket_not_allowed", allowedBucket },
      { status: 403 },
    );
  }
  if (!path.startsWith("uploads/")) {
    return NextResponse.json(
      { ok: false, error: "path_not_allowed", allowedPrefix: "uploads/" },
      { status: 403 },
    );
  }

  const baseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(
    /\/+$/,
    "",
  );
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!baseUrl) {
    return NextResponse.json({ ok: false, error: "missing_supabase_url" }, { status: 500 });
  }
  if (!serviceRole) {
    return NextResponse.json(
      { ok: false, error: "missing_service_role_key" },
      { status: 500 },
    );
  }

  const url = `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeObjectPath(path)}`;

  try {
    const res = await fetch(url, {
      method: "HEAD",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${serviceRole}`,
        apikey: serviceRole,
      },
    });

    const contentLengthRaw = res.headers.get("content-length");
    const bytes =
      typeof contentLengthRaw === "string" && contentLengthRaw.trim().length > 0
        ? Number(contentLengthRaw)
        : null;
    const contentType = res.headers.get("content-type");

    if (res.status === 404) {
      return NextResponse.json(
        { ok: true, exists: false, bucket, path, bytes: null, contentType: contentType ?? null },
        { status: 200 },
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        {
          ok: false,
          error: "storage_head_failed",
          bucket,
          path,
          status: res.status,
          body: (text || "").slice(0, 500),
        },
        { status: 502 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        exists: true,
        bucket,
        path,
        bytes: Number.isFinite(bytes as number) ? bytes : null,
        contentType: contentType ?? null,
      },
      { status: 200 },
    );
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: "storage_head_exception",
        bucket,
        path,
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}

