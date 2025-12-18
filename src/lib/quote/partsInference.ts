import type { QuoteUploadFileEntry } from "@/server/quotes/uploadFiles";
import { classifyUploadFileType } from "@/lib/uploads/classifyFileType";

export type ProtoPart = {
  label: string; // ex: “Housing Bracket”
  fileIds: string[]; // quote_upload_files IDs
  confidence: number; // 0–100 scoring
  reasons: string[]; // optional debug future UI
};

type FileKind = ReturnType<typeof classifyUploadFileType>;

type NormalizedFile = {
  id: string;
  path: string;
  filename: string;
  extension: string | null;
  kind: FileKind;
  folderPath: string; // normalized, no trailing slash, "" if none
  stem: string; // filename without extension
  normalizedStem: string; // stem with rev/version tokens stripped + normalized
  normalizedStemTokens: string[];
};

const REV_TOKEN_RE = /^(rev|reva|revb|revc|revd|reve|revf|revg|revh|revi|revj|revk|revl|revm|revn|revo|revp|revq|revr|revs|revt|revu|revv|revw|revx|revy|revz)$/i;
const REV_PREFIX_RE = /^rev([a-z0-9]+)$/i;
const REV_DASH_RE = /^rev([\-_ ]?[a-z0-9]+)$/i;
const R_TOKEN_RE = /^r\d+$/i;
const VERSION_RE = /^(v|ver|version)[\-_ ]?\d+[a-z]?$/i;

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSeparators(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function basename(path: string): string {
  const normalized = normalizeSeparators(path);
  const parts = normalized.split("/");
  return (parts[parts.length - 1] ?? "").trim();
}

function dirname(path: string): string {
  const normalized = normalizeSeparators(path);
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx <= 0) return filename;
  return filename.slice(0, idx);
}

function tokenize(value: string): string[] {
  if (!value) return [];
  return value
    .split(/[\s_\-\.]+/g)
    .map((t) => t.trim())
    .filter(Boolean);
}

function normalizeToken(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function stripRevAndVersionTokensFromTokens(tokens: string[]): {
  tokens: string[];
  removed: string[];
} {
  const kept: string[] = [];
  const removed: string[] = [];

  for (const raw of tokens) {
    const t = raw.trim();
    if (!t) continue;

    const normalized = normalizeToken(t);
    if (!normalized) {
      removed.push(t);
      continue;
    }

    const isRev =
      REV_TOKEN_RE.test(t) ||
      REV_PREFIX_RE.test(t) ||
      REV_DASH_RE.test(t) ||
      normalized === "rev" ||
      /^rev[a-z0-9]+$/.test(normalized);
    const isR = R_TOKEN_RE.test(t) || /^r\d+$/.test(normalized);
    const isVer = VERSION_RE.test(t) || /^v\d+[a-z]?$/.test(normalized);

    if (isRev || isR || isVer) {
      removed.push(t);
      continue;
    }

    kept.push(t);
  }

  return { tokens: kept, removed };
}

function splitCamelCase(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

function toTitleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      if (word.length <= 1) return word.toUpperCase();
      if (/^[A-Z0-9]{2,}$/.test(word)) return word; // keep acronyms
      return word[0]!.toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function humanizeLabelFromTokens(tokens: string[]): string {
  const raw = tokens.join(" ");
  const camelSplit = splitCamelCase(raw);
  const collapsed = camelSplit.replace(/\s+/g, " ").trim();
  return toTitleCase(collapsed);
}

function normalizeStem(stem: string): {
  normalizedStem: string;
  normalizedTokens: string[];
  removedTokens: string[];
} {
  const tokens = tokenize(stem);
  const { tokens: kept, removed } = stripRevAndVersionTokensFromTokens(tokens);
  const normalizedTokens = kept
    .map((t) => splitCamelCase(t))
    .join(" ")
    .split(/\s+/g)
    .map(normalizeToken)
    .filter(Boolean);

  // Keep a stable normalized stem key.
  const normalizedStem = normalizedTokens.join("_");
  return { normalizedStem, normalizedTokens, removedTokens: removed };
}

function buildNormalizedFile(file: QuoteUploadFileEntry): NormalizedFile | null {
  const id = normalizeId(file?.id);
  if (!id) return null;

  const path = typeof file?.path === "string" ? file.path : file?.filename ?? "";
  const filename = typeof file?.filename === "string" ? file.filename : basename(path);
  const extension = typeof file?.extension === "string" ? file.extension : null;

  const stem = stripExtension(filename);
  const folderPath = dirname(path);
  const kind = classifyUploadFileType({ filename, extension });

  const { normalizedStem, normalizedTokens } = normalizeStem(stem);

  return {
    id,
    path,
    filename,
    extension,
    kind,
    folderPath,
    stem,
    normalizedStem,
    normalizedStemTokens: normalizedTokens,
  };
}

function computeConfidence(args: {
  cadCount: number;
  drawingCount: number;
  totalCount: number;
  normalizedTokens: string[];
  folderPath: string;
  reasons: string[];
}): number {
  const { cadCount, drawingCount, totalCount, normalizedTokens, folderPath, reasons } = args;
  let score = 0;

  // +30 if both CAD + Drawing found
  if (cadCount > 0 && drawingCount > 0) {
    score += 30;
    reasons.push("cad+drawing");
  }

  // +10 if CAD only with strong prefix match
  const strongPrefix = normalizedTokens.filter((t) => t.length >= 3).length >= 2;
  if (cadCount > 0 && drawingCount === 0 && strongPrefix) {
    score += 10;
    reasons.push("cad_only_strong_prefix");
  }

  // +5 for multi-file groups with same stem
  if (totalCount >= 2) {
    score += 5;
    reasons.push("multi_file_same_stem");
  }

  // +2 if folder path includes matching token
  const folderLower = (folderPath ?? "").toLowerCase();
  const hasFolderToken = normalizedTokens.some((t) => t && folderLower.includes(t));
  if (hasFolderToken) {
    score += 2;
    reasons.push("folder_token_match");
  }

  return Math.max(0, Math.min(100, score));
}

export function inferProtoParts(files: QuoteUploadFileEntry[]): ProtoPart[] {
  const normalizedFiles = (files ?? [])
    .map(buildNormalizedFile)
    .filter((f): f is NormalizedFile => Boolean(f));

  const byStem = new Map<string, NormalizedFile[]>();
  for (const file of normalizedFiles) {
    const key = file.normalizedStem || normalizeToken(file.stem) || normalizeToken(file.filename);
    if (!key) continue;
    if (!byStem.has(key)) byStem.set(key, []);
    byStem.get(key)!.push(file);
  }

  const protoParts: ProtoPart[] = [];

  for (const [stemKey, group] of byStem.entries()) {
    if (!group || group.length === 0) continue;

    // Prefer a stable label derived from the most informative tokenization.
    const tokens = group
      .map((f) => f.normalizedStemTokens)
      .reduce<string[]>((best, current) => (current.length > best.length ? current : best), []);

    const label = humanizeLabelFromTokens(tokens.length > 0 ? tokens : tokenize(group[0]!.stem));

    const fileIds = group.map((f) => f.id);
    const cadCount = group.filter((f) => f.kind === "cad").length;
    const drawingCount = group.filter((f) => f.kind === "drawing").length;

    // Use the most common folder path in the group (helps ZIP members).
    const folderCounts = new Map<string, number>();
    for (const f of group) {
      const folder = f.folderPath || "";
      folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
    }
    const folderPath = Array.from(folderCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

    const reasons: string[] = [`stem:${stemKey}`];
    const confidence = computeConfidence({
      cadCount,
      drawingCount,
      totalCount: group.length,
      normalizedTokens: tokens,
      folderPath,
      reasons,
    });

    // Only surface suggestions that look like actual part groupings.
    const hasRelevantFiles = cadCount > 0 || drawingCount > 0;
    if (!hasRelevantFiles) continue;

    protoParts.push({
      label: label || "Untitled part",
      fileIds,
      confidence,
      reasons,
    });
  }

  return protoParts.sort((a, b) => b.confidence - a.confidence);
}
