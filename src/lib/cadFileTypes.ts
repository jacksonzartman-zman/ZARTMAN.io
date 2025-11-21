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

const CAD_FILE_TYPE_DESCRIPTION =
  "STEP, IGES, STL, SolidWorks (SLDPRT / SLDASM), PDF, or zipped assemblies";

const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

const isAllowedCadFileName = (fileName: string): boolean => {
  const parts = fileName.toLowerCase().split(".");
  const ext = parts.length > 1 ? parts.pop()! : "";
  return CAD_EXTENSION_SET.has(ext);
};

const bytesToMegabytes = (bytes: number): number =>
  Number((bytes / (1024 * 1024)).toFixed(1));

export {
  CAD_ACCEPT_STRING,
  CAD_EXTENSIONS,
  CAD_FILE_TYPE_DESCRIPTION,
  MAX_UPLOAD_SIZE_BYTES,
  bytesToMegabytes,
  isAllowedCadFileName,
};
