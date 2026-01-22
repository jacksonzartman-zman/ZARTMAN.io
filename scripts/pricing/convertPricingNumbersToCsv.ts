import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

type DelimiterMode = "auto" | "csv" | "tsv" | "multi-space";

type CliArgs = {
  inPath: string;
  outPath: string;
  delimiter: DelimiterMode;
  amountColumn?: string;
  technologyColumn?: string;
  materialsColumn?: string;
  partsCountColumn?: string;
  marginAmountColumn?: string;
};

const DEFAULT_IN = resolve(process.cwd(), "data/pricing_for_algo.txt");
const DEFAULT_OUT = resolve(process.cwd(), "data/pricing_for_algo.cleaned.csv");

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { inPath: DEFAULT_IN, outPath: DEFAULT_OUT, delimiter: "auto" };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      printHelpAndExit(0);
    }
    if (a === "--in") {
      const v = argv[i + 1];
      if (!v) throw new Error("Missing value for --in");
      out.inPath = resolve(process.cwd(), v);
      i += 1;
      continue;
    }
    if (a === "--out") {
      const v = argv[i + 1];
      if (!v) throw new Error("Missing value for --out");
      out.outPath = resolve(process.cwd(), v);
      i += 1;
      continue;
    }
    if (a === "--delimiter") {
      const v = argv[i + 1];
      if (!v) throw new Error("Missing value for --delimiter");
      if (v !== "auto" && v !== "csv" && v !== "tsv" && v !== "multi-space") {
        throw new Error(`Invalid --delimiter value: ${v}`);
      }
      out.delimiter = v;
      i += 1;
      continue;
    }

    if (a === "--amountColumn") {
      const v = argv[i + 1];
      if (!v) throw new Error("Missing value for --amountColumn");
      out.amountColumn = v;
      i += 1;
      continue;
    }
    if (a === "--technologyColumn") {
      const v = argv[i + 1];
      if (!v) throw new Error("Missing value for --technologyColumn");
      out.technologyColumn = v;
      i += 1;
      continue;
    }
    if (a === "--materialsColumn") {
      const v = argv[i + 1];
      if (!v) throw new Error("Missing value for --materialsColumn");
      out.materialsColumn = v;
      i += 1;
      continue;
    }
    if (a === "--partsCountColumn") {
      const v = argv[i + 1];
      if (!v) throw new Error("Missing value for --partsCountColumn");
      out.partsCountColumn = v;
      i += 1;
      continue;
    }
    if (a === "--marginAmountColumn") {
      const v = argv[i + 1];
      if (!v) throw new Error("Missing value for --marginAmountColumn");
      out.marginAmountColumn = v;
      i += 1;
      continue;
    }

    throw new Error(`Unknown arg: ${a}`);
  }

  return out;
}

function printHelpAndExit(code: number): never {
  // eslint-disable-next-line no-console
  console.log(
    [
      "convertPricingNumbersToCsv.ts",
      "",
      "Reads a 'Pricing for algo' export from /data/ and outputs a clean CSV with headers:",
      "amount, technology, material_raw, material_canon, parts_count, margin_amount, margin_percent",
      "",
      "Usage:",
      "  npx tsx scripts/pricing/convertPricingNumbersToCsv.ts --in data/pricing_for_algo.txt --out data/pricing_for_algo.cleaned.csv",
      "",
      "Options:",
      "  --delimiter auto|csv|tsv|multi-space   Default: auto",
      "  --amountColumn <header name>          Override detected source column for amount",
      "  --technologyColumn <header name>      Override detected source column for technology",
      "  --materialsColumn <header name>       Override detected source column for materials",
      "  --partsCountColumn <header name>      Override detected source column for parts count",
      "  --marginAmountColumn <header name>    Override detected source column for margin amount",
      "",
    ].join("\n"),
  );
  process.exit(code);
}

function normalizeHeader(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSpaces(s: string): string {
  return String(s ?? "").trim().replace(/\s+/g, " ");
}

function csvEscape(value: string): string {
  const v = String(value ?? "");
  if (v.includes('"') || v.includes(",") || v.includes("\n") || v.includes("\r")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function parseNumber(raw: string): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  // Allow "$1,234.56", "1,234", "(123.45)", " 123 ", etc.
  const isParenNeg = /^\(.*\)$/.test(s);
  const cleaned = s
    .replace(/^\(/, "")
    .replace(/\)$/, "")
    .replace(/[$,]/g, "")
    .replace(/[%]/g, "")
    .trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return isParenNeg ? -n : n;
}

function parseInteger(raw: string): number | null {
  const n = parseNumber(raw);
  if (n === null) return null;
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function detectDelimiterMode(headerLine: string): DelimiterMode {
  if (headerLine.includes("\t")) return "tsv";
  if (headerLine.includes(",")) return "csv";
  if (/\s{2,}/.test(headerLine)) return "multi-space";
  return "multi-space";
}

function parseDelimitedLine(line: string, mode: Exclude<DelimiterMode, "auto">): string[] {
  if (mode === "multi-space") {
    return line.split(/\s{2,}/g).map((s) => s.trim());
  }
  const delimiterChar = mode === "tsv" ? "\t" : ",";
  return parseQuotedLine(line, delimiterChar);
}

function parseQuotedLine(line: string, delimiterChar: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] ?? "";
    if (ch === '"') {
      const next = line[i + 1] ?? "";
      if (inQuotes && next === '"') {
        cur += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === delimiterChar) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function findColumnIndexByOverride(headers: string[], override?: string): number | null {
  if (!override) return null;
  const target = normalizeHeader(override);
  const normalized = headers.map(normalizeHeader);
  const idx = normalized.findIndex((h) => h === target);
  return idx >= 0 ? idx : null;
}

function findColumnIndex(headers: string[], opts: { includeAny: string[]; excludeAny?: string[] }): number | null {
  const normalized = headers.map(normalizeHeader);
  const include = opts.includeAny.map((s) => normalizeHeader(s));
  const exclude = (opts.excludeAny ?? []).map((s) => normalizeHeader(s));

  // Prefer exact matches against any include candidate.
  for (const inc of include) {
    const idx = normalized.findIndex((h) => h === inc);
    if (idx >= 0) return idx;
  }

  // Then substring matches (token-aware) with exclude filtering.
  const idx = normalized.findIndex((h) => {
    const hasInclude = include.some((inc) => inc && h.includes(inc));
    const hasExclude = exclude.some((exc) => exc && h.includes(exc));
    return hasInclude && !hasExclude;
  });
  return idx >= 0 ? idx : null;
}

function materialCanon(materialRaw: string): string {
  const trimmed = String(materialRaw ?? "").trim();
  const beforePipe = trimmed.includes("|") ? trimmed.split("|")[0] ?? "" : trimmed;
  return beforePipe.trim().replace(/\s+/g, " ");
}

// Add/expand synonyms here over time.
const TECHNOLOGY_SYNONYMS: Record<string, string> = {
  // "cnc": "CNC machining",
  // "cnc machining": "CNC machining",
};

function technologyCanon(technologyRaw: string): string {
  const cleaned = normalizeSpaces(technologyRaw);
  if (!cleaned) return "";
  const key = normalizeHeader(cleaned);
  return TECHNOLOGY_SYNONYMS[key] ?? cleaned;
}

function ensureParentDir(path: string) {
  const dir = dirname(path);
  if (existsSync(dir)) return;
  mkdirSync(dir, { recursive: true });
}

function pickCell(cells: string[], idx: number | null): string {
  if (idx === null) return "";
  return String(cells[idx] ?? "").trim();
}

function run() {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(args.inPath)) {
    throw new Error(
      `Input file not found: ${args.inPath}\n` +
        `Put your 'Pricing for algo' export in ${resolve(process.cwd(), "data/")} and re-run with --in.`,
    );
  }

  const raw = readFileSync(args.inPath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/\uFEFF/g, ""))
    .filter((l) => l.trim().length > 0);

  if (lines.length < 2) {
    throw new Error("Input file must include a header row and at least one data row.");
  }

  const effectiveMode: Exclude<DelimiterMode, "auto"> =
    args.delimiter === "auto" ? detectDelimiterMode(lines[0] ?? "") : args.delimiter;

  const headerCells = parseDelimitedLine(lines[0] ?? "", effectiveMode);
  const headers = headerCells.map((h) => h.trim());

  const amountIdx =
    findColumnIndexByOverride(headers, args.amountColumn) ??
    findColumnIndex(headers, { includeAny: ["amount", "estimated close amount", "close amount"], excludeAny: ["margin"] });
  const technologyIdx =
    findColumnIndexByOverride(headers, args.technologyColumn) ??
    findColumnIndex(headers, { includeAny: ["technologies", "technology", "process"] });
  const materialsIdx =
    findColumnIndexByOverride(headers, args.materialsColumn) ??
    findColumnIndex(headers, { includeAny: ["materials", "material"] });
  const partsCountIdx =
    findColumnIndexByOverride(headers, args.partsCountColumn) ??
    findColumnIndex(headers, { includeAny: ["parts count", "part count", "parts"] });
  const marginAmountIdx =
    findColumnIndexByOverride(headers, args.marginAmountColumn) ??
    findColumnIndex(headers, { includeAny: ["margin amount"], excludeAny: ["pre calculated", "percent"] }) ??
    findColumnIndex(headers, { includeAny: ["margin"], excludeAny: ["pre calculated", "percent"] });

  if (amountIdx === null) {
    throw new Error(
      `Could not detect amount column from headers: ${JSON.stringify(headers)}\n` +
        "Provide an explicit column name via --amountColumn.",
    );
  }
  if (materialsIdx === null) {
    throw new Error(
      `Could not detect materials column from headers: ${JSON.stringify(headers)}\n` +
        "Provide an explicit column name via --materialsColumn.",
    );
  }
  if (marginAmountIdx === null) {
    throw new Error(
      `Could not detect margin amount column from headers: ${JSON.stringify(headers)}\n` +
        "Provide an explicit column name via --marginAmountColumn.",
    );
  }

  const outLines: string[] = [];
  outLines.push(
    ["amount", "technology", "material_raw", "material_canon", "parts_count", "margin_amount", "margin_percent"]
      .map(csvEscape)
      .join(","),
  );

  let rowsWritten = 0;
  let rowsSkipped = 0;

  for (let lineIdx = 1; lineIdx < lines.length; lineIdx += 1) {
    const line = lines[lineIdx] ?? "";
    const cells = parseDelimitedLine(line, effectiveMode);

    const amountRaw = pickCell(cells, amountIdx);
    const technologyRaw = pickCell(cells, technologyIdx);
    const materialsRaw = pickCell(cells, materialsIdx);
    const partsCountRaw = pickCell(cells, partsCountIdx);
    const marginAmountRaw = pickCell(cells, marginAmountIdx);

    const amount = parseNumber(amountRaw);
    const marginAmount = parseNumber(marginAmountRaw);
    const partsCount = parseInteger(partsCountRaw);

    const marginPercent =
      amount !== null && amount > 0 && marginAmount !== null ? marginAmount / amount : null;

    // Preserve rows even if parts_count is missing; only skip truly empty lines.
    const hasAny =
      (amountRaw && amountRaw.trim()) ||
      (technologyRaw && technologyRaw.trim()) ||
      (materialsRaw && materialsRaw.trim()) ||
      (partsCountRaw && partsCountRaw.trim()) ||
      (marginAmountRaw && marginAmountRaw.trim());
    if (!hasAny) {
      rowsSkipped += 1;
      continue;
    }

    const row = [
      amount === null ? "" : String(amount),
      technologyCanon(technologyRaw),
      normalizeSpaces(materialsRaw),
      materialCanon(materialsRaw),
      partsCount === null ? "" : String(partsCount),
      marginAmount === null ? "" : String(marginAmount),
      marginPercent === null ? "" : String(Number(marginPercent.toFixed(6))),
    ];

    outLines.push(row.map(csvEscape).join(","));
    rowsWritten += 1;
  }

  ensureParentDir(args.outPath);
  writeFileSync(args.outPath, outLines.join("\n") + "\n", "utf8");

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        in: args.inPath,
        out: args.outPath,
        delimiter: effectiveMode,
        headerCount: headers.length,
        rowsWritten,
        rowsSkipped,
      },
      null,
      2,
    ),
  );
}

run();
