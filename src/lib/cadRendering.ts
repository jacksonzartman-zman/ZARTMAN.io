export type CadRenderableFileType = "step" | "stl" | "obj" | "glb";

export type CadRenderClassification =
  | { ok: true; type: CadRenderableFileType; extension: CadRenderableFileType }
  | { ok: false; type: "unsupported" | "unknown"; extension: string | null };

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

export function classifyCadFileType(input: {
  filename?: string | null;
  extension?: string | null;
}): CadRenderClassification {
  const ext =
    normalizeExtension(input.extension) ??
    normalizeExtension(extractExtensionFromName(input.filename));

  if (!ext) {
    return { ok: false, type: "unknown", extension: null };
  }

  if (ext === "stp" || ext === "step") {
    return { ok: true, type: "step", extension: "step" };
  }

  if (ext === "stl") {
    return { ok: true, type: "stl", extension: "stl" };
  }

  if (ext === "obj") {
    return { ok: true, type: "obj", extension: "obj" };
  }

  if (ext === "glb" || ext === "gltf") {
    return { ok: true, type: "glb", extension: "glb" };
  }

  return { ok: false, type: "unsupported", extension: ext };
}

