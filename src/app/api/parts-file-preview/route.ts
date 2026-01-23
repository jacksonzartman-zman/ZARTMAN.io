import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { getServerAuthUser, requireAdminUser } from "@/server/auth";
import { loadSupplierProfileByUserId } from "@/server/suppliers";
import { assertSupplierQuoteAccess } from "@/server/quotes/access";
import { supabaseServer } from "@/lib/supabaseServer";
import { getCustomerByEmail, getCustomerByUserId } from "@/server/customers";
import { ensureStepPreviewForFile } from "@/server/quotes/stepPreview";

export const dynamic = "force-dynamic";

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePreviewAs(value: unknown): "original" | "stl_preview" {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw === "stl_preview" ? "stl_preview" : "original";
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export async function GET(req: NextRequest) {
  const fileId = normalizeId(req.nextUrl.searchParams.get("fileId"));
  const quoteIdParam = normalizeId(req.nextUrl.searchParams.get("quoteId"));
  const dispositionRaw = normalizeId(req.nextUrl.searchParams.get("disposition"));
  const disposition = dispositionRaw === "attachment" ? "attachment" : "inline";
  const previewAs = normalizePreviewAs(req.nextUrl.searchParams.get("previewAs"));

  if (!fileId) {
    return new NextResponse("missing_identifiers", { status: 400 });
  }

  // Resolve quote id from file id (preferred), to support callers that only know `fileId`.
  const { data: fileRow, error: fileRowError } = await supabaseServer()
    .from("quote_upload_files")
    .select("id,quote_id,filename,extension")
    .eq("id", fileId)
    .maybeSingle<{
      id: string;
      quote_id: string;
      filename: string;
      extension: string | null;
    }>();

  const quoteId = normalizeId(fileRow?.quote_id);
  if (fileRowError || !quoteId) {
    // Avoid leaking whether an id exists; treat as not found.
    return new NextResponse("not_found", { status: 404 });
  }

  // If a quoteId was supplied, ensure it matches the resolved quote id to avoid surprising cross-quote requests.
  if (quoteIdParam && quoteIdParam !== quoteId) {
    return new NextResponse("not_found", { status: 404 });
  }

  // Access control:
  // - Admin users: allowed via server-set httpOnly cookie gate.
  // - Suppliers: must satisfy supplier quote access rules.
  // - Customers: must match quote.customer_id or quote.customer_email.
  const { user } = await getServerAuthUser();
  if (!user?.id) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  let isAdmin = false;
  try {
    await requireAdminUser();
    isAdmin = true;
  } catch {
    isAdmin = false;
  }

  if (!isAdmin) {
    const profile = await loadSupplierProfileByUserId(user.id);
    const supplierId = profile?.supplier?.id ?? null;

    if (supplierId) {
      const access = await assertSupplierQuoteAccess({
        quoteId,
        supplierId,
        supplierUserEmail: user.email ?? null,
      });
      if (!access.ok) {
        return new NextResponse("forbidden", { status: 403 });
      }
    } else {
      const userEmail = normalizeEmail(user.email ?? null);
      const customer = await getCustomerByUserId(user.id);
      const customerFallback = !customer && userEmail ? await getCustomerByEmail(userEmail) : null;
      const customerId = normalizeId(customer?.id ?? customerFallback?.id ?? null) || null;
      const customerEmail = normalizeEmail(
        customer?.email ?? customerFallback?.email ?? userEmail,
      );

      const { data: quoteRow } = await supabaseServer()
        .from("quotes")
        .select("id,customer_id,customer_email")
        .eq("id", quoteId)
        .maybeSingle<{ id: string; customer_id: string | null; customer_email: string | null }>();

      const quoteCustomerId = normalizeId(quoteRow?.customer_id);
      const quoteCustomerEmail = normalizeEmail(quoteRow?.customer_email ?? null);

      const customerIdMatches =
        Boolean(customerId) && Boolean(quoteCustomerId) && customerId === quoteCustomerId;
      const customerEmailMatches =
        Boolean(customerEmail) &&
        Boolean(quoteCustomerEmail) &&
        customerEmail === quoteCustomerEmail;
      const userEmailMatches =
        Boolean(userEmail) && Boolean(quoteCustomerEmail) && userEmail === quoteCustomerEmail;

      if (!customerIdMatches && !customerEmailMatches && !userEmailMatches) {
        return new NextResponse("forbidden", { status: 403 });
      }
    }
  }

  const ext = normalizeId(fileRow?.extension ?? "").toLowerCase().replace(/^\./, "");
  const isStep = ext === "step" || ext === "stp" || (fileRow?.filename ?? "").toLowerCase().endsWith(".step") || (fileRow?.filename ?? "").toLowerCase().endsWith(".stp");

  // STEP STL preview path (generated on demand server-side).
  if (isStep && previewAs === "stl_preview") {
    const preview = await ensureStepPreviewForFile(fileId);
    if (!preview) {
      return NextResponse.json({ error: "step_preview_unavailable" }, { status: 502 });
    }

    const { data: blob, error: downloadError } = await supabaseServer().storage
      .from(preview.bucket)
      .download(preview.path);

    if (downloadError || !blob) {
      return NextResponse.json({ error: "step_preview_unavailable" }, { status: 502 });
    }

    return new NextResponse(blob.stream(), {
      status: 200,
      headers: {
        "Content-Type": "model/stl",
        "Content-Disposition": "inline",
        "Cache-Control": "no-store",
      },
    });
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
