const CAD_EXTENSIONS = [
  "stl",
  "step",
  "stp",
  "iges",
  "igs",
  "sldprt",
  "sldasm",
  "pdf",
  "zip",
] as const;

const CAD_EXTENSION_SET = new Set<string>(CAD_EXTENSIONS);

/**
 * When this accept string is attached to <input type="file">, iOS/iPadOS Safari
 * will keep STL/STEP-style formats selectable instead of graying them out.
 * Apple requires a literal list of dot-prefixed extensions.
 */
const CAD_ACCEPT_STRING = CAD_EXTENSIONS.map((ext) => `.${ext}`).join(",");

const isAllowedCadFileName = (fileName: string): boolean => {
  const parts = fileName.toLowerCase().split(".");
  const ext = parts.length > 1 ? parts.pop()! : "";
  return CAD_EXTENSION_SET.has(ext);
};

export { CAD_ACCEPT_STRING, CAD_EXTENSIONS, isAllowedCadFileName };
