export const PROVIDER_IMPORT_TYPES = [
  "marketplace",
  "direct_supplier",
  "factory",
  "broker",
] as const;

export type ProviderImportType = (typeof PROVIDER_IMPORT_TYPES)[number];

export type ProviderImportRow = {
  line: number;
  name: string;
  website: string | null;
  email: string | null;
  providerType: ProviderImportType | null;
  errors: string[];
};

export type ProviderImportParseResult = {
  rows: ProviderImportRow[];
  validRows: ProviderImportRow[];
  headerDetected: boolean;
};

type ParsedCsvRow = {
  line: number;
  fields: string[];
};

const HEADER_FIELDS = ["name", "website", "email", "provider_type"];

export function parseProviderImportCsv(input: string): ProviderImportParseResult {
  const csvRows = parseCsvRows(input);
  if (csvRows.length === 0) {
    return { rows: [], validRows: [], headerDetected: false };
  }

  const headerDetected = detectHeaderRow(csvRows[0]?.fields);
  const rowsToParse = headerDetected ? csvRows.slice(1) : csvRows;
  const rows: ProviderImportRow[] = [];

  for (const row of rowsToParse) {
    if (isEmptyRow(row.fields)) {
      continue;
    }
    rows.push(parseProviderRow(row));
  }

  markDuplicateNames(rows);
  const validRows = rows.filter((row) => row.errors.length === 0);

  return { rows, validRows, headerDetected };
}

function parseProviderRow(row: ParsedCsvRow): ProviderImportRow {
  const trimmed = row.fields.map((field) => field.trim());
  const errors: string[] = [];
  const columnCount = trimmed.length;

  if (columnCount < 4) {
    errors.push(`Expected 4 columns, found ${columnCount}.`);
  } else if (columnCount > 4) {
    errors.push(`Expected 4 columns, found ${columnCount}. Extra data after provider_type.`);
  }

  const name = trimmed[0] ?? "";
  const websiteInput = trimmed[1] ?? "";
  const emailInput = trimmed[2] ?? "";
  const providerTypeInput = trimmed[3] ?? "";

  if (!name) {
    errors.push("Name is required.");
  }

  const email = normalizeEmail(emailInput);
  if (!email) {
    errors.push("Email is required and must be valid.");
  }

  const { normalizedWebsite, error: websiteError } = normalizeWebsite(websiteInput);
  if (websiteError) {
    errors.push(websiteError);
  }

  const providerType = normalizeProviderType(providerTypeInput);
  if (!providerType) {
    errors.push(
      `Provider type must be one of: ${PROVIDER_IMPORT_TYPES.join(", ")}.`,
    );
  }

  return {
    line: row.line,
    name,
    website: normalizedWebsite,
    email,
    providerType,
    errors,
  };
}

function normalizeEmail(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (!trimmed.includes("@")) return null;
  if (/\s/.test(trimmed)) return null;
  const parts = trimmed.split("@");
  if (parts.length !== 2) return null;
  if (!parts[0] || !parts[1] || !parts[1].includes(".")) return null;
  return trimmed;
}

function normalizeWebsite(value: string): {
  normalizedWebsite: string | null;
  error: string | null;
} {
  const trimmed = value.trim();
  if (!trimmed) {
    return { normalizedWebsite: null, error: null };
  }
  const hasScheme = /^https?:\/\//i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return { normalizedWebsite: url.toString(), error: null };
  } catch {
    return { normalizedWebsite: trimmed, error: "Website must be a valid URL." };
  }
}

function normalizeProviderType(value: string): ProviderImportType | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return PROVIDER_IMPORT_TYPES.includes(trimmed as ProviderImportType)
    ? (trimmed as ProviderImportType)
    : null;
}

function parseCsvRows(input: string): ParsedCsvRow[] {
  const sanitized = (input ?? "").replace(/\uFEFF/g, "");
  if (!sanitized.trim()) {
    return [];
  }

  const rows: ParsedCsvRow[] = [];
  let field = "";
  let fields: string[] = [];
  let inQuotes = false;
  let line = 1;

  for (let i = 0; i < sanitized.length; i += 1) {
    const char = sanitized[i];

    if (char === '"') {
      if (inQuotes && sanitized[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      fields.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && sanitized[i + 1] === "\n") {
        i += 1;
      }
      fields.push(field);
      rows.push({ line, fields });
      field = "";
      fields = [];
      line += 1;
      continue;
    }

    field += char;
  }

  fields.push(field);
  rows.push({ line, fields });

  return rows.filter((row) => !isEmptyRow(row.fields));
}

function detectHeaderRow(fields: string[] | undefined): boolean {
  if (!fields || fields.length < 4) return false;
  const normalized = fields.slice(0, 4).map((value) =>
    value.trim().toLowerCase().replace(/\s+/g, "_"),
  );
  return HEADER_FIELDS.every((field, index) => normalized[index] === field);
}

function isEmptyRow(fields: string[]): boolean {
  return fields.every((field) => field.trim().length === 0);
}

function markDuplicateNames(rows: ProviderImportRow[]): void {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.name.trim().toLowerCase();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  for (const row of rows) {
    const key = row.name.trim().toLowerCase();
    if (!key) continue;
    if ((counts.get(key) ?? 0) > 1) {
      row.errors.push("Duplicate name in CSV.");
    }
  }
}
