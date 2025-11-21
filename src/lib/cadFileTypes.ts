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
 * Strict accept list for desktop file inputs. iOS/iPadOS Safari still greys out
 * some of these extensions, so the client relaxes the attribute there and
 * relies on server-side validation instead.
 */
const CAD_ACCEPT_STRING = CAD_EXTENSIONS.map((ext) => `.${ext}`).join(",");

const isAllowedCadFileName = (fileName: string): boolean => {
  const parts = fileName.toLowerCase().split(".");
  const ext = parts.length > 1 ? parts.pop()! : "";
  return CAD_EXTENSION_SET.has(ext);
};

export { CAD_ACCEPT_STRING, CAD_EXTENSIONS, isAllowedCadFileName };
