export type UploadFileTypeCategory = "cad" | "drawing" | "other";

const CAD_EXTENSIONS = new Set([
  "step",
  "stp",
  "iges",
  "igs",
  "stl",
  "sldprt",
  "sldasm",
  "x_t",
  "x_b",
  "xmt_txt",
  "xmt_bin",
  "prt",
  "asm",
]);

const DRAWING_EXTENSIONS = new Set(["pdf", "dwg", "dxf"]);

export function classifyUploadFileType(input: {
  filename?: string | null;
  extension?: string | null;
}): UploadFileTypeCategory {
  const ext =
    normalizeExtension(input.extension) ??
    normalizeExtension(extractExtensionFromName(input.filename));

  if (!ext) {
    return "other";
  }
  if (CAD_EXTENSIONS.has(ext)) {
    return "cad";
  }
  if (DRAWING_EXTENSIONS.has(ext)) {
    return "drawing";
  }
  return "other";
}

function extractExtensionFromName(fileName?: string | null): string | null {
  if (typeof fileName !== "string") {
    return null;
  }
  const trimmed = fileName.trim();
  if (!trimmed) {
    return null;
  }
  const parts = trimmed.split(".");
  if (parts.length < 2) {
    return null;
  }
  return parts[parts.length - 1] ?? null;
}

function normalizeExtension(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  return trimmed.startsWith(".") ? trimmed.slice(1) : trimmed;
}

