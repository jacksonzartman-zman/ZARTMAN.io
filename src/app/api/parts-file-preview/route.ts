import { NextResponse, type NextRequest } from "next/server";
import { getServerAuthUser } from "@/server/auth";
import { loadSupplierProfileByUserId } from "@/server/suppliers";
import { assertSupplierQuoteAccess } from "@/server/quotes/access";

export const dynamic = "force-dynamic";

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(req: NextRequest) {
  const quoteId = normalizeId(req.nextUrl.searchParams.get("quoteId"));
  const fileId = normalizeId(req.nextUrl.searchParams.get("fileId"));
  const dispositionRaw = normalizeId(req.nextUrl.searchParams.get("disposition"));
  const disposition = dispositionRaw === "attachment" ? "attachment" : "inline";

  if (!quoteId || !fileId) {
    return new NextResponse("missing_identifiers", { status: 400 });
  }

  const { user } = await getServerAuthUser();
  if (!user?.id) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const profile = await loadSupplierProfileByUserId(user.id);
  const supplierId = profile?.supplier?.id ?? null;
  if (!supplierId) {
    return new NextResponse("supplier_profile_missing", { status: 403 });
  }

  const access = await assertSupplierQuoteAccess({
    quoteId,
    supplierId,
    supplierUserEmail: user.email ?? null,
  });
  if (!access.ok) {
    return new NextResponse("forbidden", { status: 403 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!baseUrl || typeof baseUrl !== "string") {
    return new NextResponse("misconfigured", { status: 500 });
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/functions/v1/parts-file-preview`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.SUPABASE_SERVICE_ROLE_KEY
        ? { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` }
        : {}),
    },
    body: JSON.stringify({ quoteId, fileId, disposition }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return new NextResponse(text || "preview_failed", { status: res.status });
  }

  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const contentDisposition = res.headers.get("content-disposition");

  const body = res.body;
  if (!body) {
    return new NextResponse("empty", { status: 500 });
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      ...(contentDisposition ? { "Content-Disposition": contentDisposition } : {}),
      // Avoid caching previews.
      "Cache-Control": "no-store",
    },
  });
}
