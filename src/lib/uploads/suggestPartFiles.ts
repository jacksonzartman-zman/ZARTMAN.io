import type { QuoteUploadFileEntry } from "@/server/quotes/uploadFiles";
import { classifyUploadFileType } from "@/lib/uploads/classifyFileType";

export type PartFileSuggestionScore = {
  fileId: string;
  score: number;
  reasons: string[];
};

function normalizeToken(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function scoreFilesForPart(opts: {
  partLabel: string;
  partIndex?: number;
  files: QuoteUploadFileEntry[];
}): PartFileSuggestionScore[] {
  const partLabel = (opts.partLabel ?? "").toLowerCase().trim();
  const tokens = partLabel
    .split(/[\s_\-]+/)
    .map(normalizeToken)
    .filter(Boolean);

  return (opts.files ?? []).map((file) => {
    const reasons: string[] = [];
    let score = 0;

    const filename = (file.filename ?? file.path ?? "").toLowerCase();
    const path = (file.path ?? "").toLowerCase();

    // 1) Token matches in filename / path
    for (const token of tokens) {
      if (!token) continue;
      if (filename.includes(token)) {
        score += 3;
        reasons.push(`token:${token}`);
      } else if (path.includes(token)) {
        score += 1;
        reasons.push(`path:${token}`);
      }
    }

    // 2) Prefer drawings slightly (CAD vs drawing heuristic)
    const kind = classifyUploadFileType({
      filename: file.filename,
      extension: file.extension ?? null,
    });
    if (kind === "drawing") {
      score += 1;
      reasons.push("kind:drawing");
    }

    // 3) Light positional bias: earlier parts get slightly higher base
    if (typeof opts.partIndex === "number") {
      const bias = Math.max(0, 3 - opts.partIndex);
      if (bias > 0) reasons.push(`bias:${bias}`);
      score += bias;
    }

    return { fileId: file.id, score, reasons };
  });
}

export function sortFilesByPartSuggestion(
  files: QuoteUploadFileEntry[],
  suggestions: PartFileSuggestionScore[],
) {
  const scoreById = new Map(suggestions.map((s) => [s.fileId, s.score] as const));

  return [...(files ?? [])].sort((a, b) => {
    const sa = scoreById.get(a.id) ?? 0;
    const sb = scoreById.get(b.id) ?? 0;
    if (sa === sb) {
      return (a.filename ?? "").localeCompare(b.filename ?? "");
    }
    return sb - sa;
  });
}
