import { buildPublicUrl } from "@/lib/publicUrl";

type CanonicalFileInput = {
  fileName: string | null | undefined;
  storageSource?: { bucket: string; path: string } | null | undefined;
};

type UploadEntryInput = {
  filename: string | null | undefined;
  path?: string | null | undefined;
};

type ShipToInput = {
  freeform?: string | null;
  name?: string | null;
  company?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatValueOrDash(value: unknown): string {
  const v = normalizeText(value);
  return v ? v : "—";
}

function buildShipToLines(input: ShipToInput | null | undefined): string[] {
  if (!input) return [];

  const freeform = normalizeText(input.freeform);
  if (freeform) {
    return freeform.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  const lines: string[] = [];

  const name = normalizeText(input.name);
  const company = normalizeText(input.company);
  if (name || company) {
    lines.push([name, company].filter(Boolean).join(" · "));
  }

  const address1 = normalizeText(input.address1);
  const address2 = normalizeText(input.address2);
  if (address1) lines.push(address1);
  if (address2) lines.push(address2);

  const city = normalizeText(input.city);
  const state = normalizeText(input.state);
  const postal = normalizeText(input.postalCode);
  const country = normalizeText(input.country);

  const cityLine = [city, state].filter(Boolean).join(", ");
  const cityPostal = [cityLine, postal].filter(Boolean).join(" ");
  if (cityPostal) lines.push(cityPostal);
  if (country) lines.push(country);

  return lines;
}

function buildStorageDownloadUrl(args: {
  bucket: string;
  path: string;
  filename?: string | null;
}): string {
  const qs = new URLSearchParams();
  qs.set("bucket", args.bucket);
  qs.set("path", args.path);
  if (args.filename) qs.set("filename", args.filename);
  qs.set("disposition", "attachment");
  return buildPublicUrl(`/api/storage-download?${qs.toString()}`);
}

export function buildAdminRfqPackText(args: {
  quoteId: string;
  intakeKey?: string | null;
  manufacturingProcess?: string | null;
  quantity?: string | null;
  needBy?: string | null;
  customerNotes?: string | null;
  poNumber?: string | null;
  shipTo?: ShipToInput | null;
  canonicalFiles?: CanonicalFileInput[];
  uploadEntries?: UploadEntryInput[];
}): string {
  const quoteId = normalizeText(args.quoteId);

  const lines: string[] = [];
  lines.push("RFQ PACK");

  lines.push("");
  lines.push("LINKS");
  lines.push(`- Admin: ${buildPublicUrl(`/admin/quotes/${quoteId}`)}`);

  const intakeKey = normalizeText(args.intakeKey);
  if (intakeKey && quoteId) {
    const qs = new URLSearchParams();
    qs.set("quote", quoteId);
    qs.set("key", intakeKey);
    lines.push(`- Customer RFQ status: ${buildPublicUrl(`/rfq?${qs.toString()}`)}`);
  }

  lines.push("");
  lines.push("FILES");

  const canonical = Array.isArray(args.canonicalFiles) ? args.canonicalFiles : [];
  const canonicalRows = canonical
    .map((file) => {
      const fileName = normalizeText(file.fileName);
      const bucket = normalizeText(file.storageSource?.bucket);
      const path = normalizeText(file.storageSource?.path);
      if (!fileName || !bucket || !path) return null;
      return { fileName, bucket, path };
    })
    .filter((row): row is { fileName: string; bucket: string; path: string } => Boolean(row));

  if (canonicalRows.length > 0) {
    lines.push("- Canonical files (storage):");
    canonicalRows.forEach((row) => {
      lines.push(`  - ${row.fileName} — ${row.bucket}/${row.path}`);
      lines.push(`    - Download: ${buildStorageDownloadUrl(row)}`);
    });
  } else {
    lines.push("- Canonical files (storage): —");
  }

  const uploads = Array.isArray(args.uploadEntries) ? args.uploadEntries : [];
  const uploadRows = uploads
    .map((entry) => {
      const filename = normalizeText(entry.filename);
      const path = normalizeText(entry.path ?? "");
      if (!filename && !path) return null;
      return { filename: filename || path || "File", path: path || null };
    })
    .filter((row): row is { filename: string; path: string | null } => Boolean(row));

  const MAX_UPLOAD_LINES = 60;
  if (uploadRows.length > 0) {
    lines.push("- Upload entries (best-effort paths):");
    uploadRows.slice(0, MAX_UPLOAD_LINES).forEach((row) => {
      const suffix = row.path && row.path !== row.filename ? ` — ${row.path}` : "";
      lines.push(`  - ${row.filename}${suffix}`);
    });
    const remaining = uploadRows.length - MAX_UPLOAD_LINES;
    if (remaining > 0) {
      lines.push(`  - …and ${remaining} more`);
    }
  } else {
    lines.push("- Upload entries (best-effort paths): —");
  }

  lines.push("");
  lines.push("SPECS");
  lines.push(`- Process: ${formatValueOrDash(args.manufacturingProcess)}`);
  lines.push(`- Quantity: ${formatValueOrDash(args.quantity)}`);
  lines.push(`- Need-by: ${formatValueOrDash(args.needBy)}`);

  lines.push("");
  lines.push("CUSTOMER NOTES");
  const notes = normalizeText(args.customerNotes);
  lines.push(notes ? notes : "—");

  lines.push("");
  lines.push("SHIP-TO / PO");
  const shipToLines = buildShipToLines(args.shipTo);
  if (shipToLines.length > 0) {
    lines.push("- Ship-to:");
    shipToLines.forEach((line) => lines.push(`  ${line}`));
  } else {
    lines.push("- Ship-to: —");
  }
  lines.push(`- PO: ${formatValueOrDash(args.poNumber)}`);

  return `${lines.join("\n").trim()}\n`;
}

