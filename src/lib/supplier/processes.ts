type ProcessLike = string | null | undefined;

function normalizeProcess(value: ProcessLike): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

export function getUniqueSupplierProcessLabels(
  processes: readonly ProcessLike[],
): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];

  for (const value of processes) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;

    const key = normalizeProcess(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    labels.push(trimmed);
  }

  return labels;
}

export function getUniqueSupplierProcessesFromCapabilities(
  capabilities: readonly { process: ProcessLike }[],
): string[] {
  return getUniqueSupplierProcessLabels(capabilities.map((cap) => cap.process));
}

export function countUniqueSupplierProcessesFromCapabilities(
  capabilities: readonly { process: ProcessLike }[],
): number {
  return getUniqueSupplierProcessesFromCapabilities(capabilities).length;
}
