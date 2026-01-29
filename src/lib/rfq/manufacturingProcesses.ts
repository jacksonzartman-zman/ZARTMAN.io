export type ManufacturingProcessKey = "cnc" | "3dp" | "sheet" | "injection";

export const MANUFACTURING_PROCESS_OPTIONS: Array<{ key: ManufacturingProcessKey; label: string }> = [
  { key: "cnc", label: "CNC" },
  { key: "3dp", label: "3DP" },
  { key: "sheet", label: "Sheet Metal" },
  { key: "injection", label: "Injection Molding" },
];

export function getManufacturingProcessLabel(key: ManufacturingProcessKey): string {
  switch (key) {
    case "cnc":
      return "CNC";
    case "3dp":
      return "3DP";
    case "sheet":
      return "Sheet Metal";
    case "injection":
      return "Injection Molding";
  }
}

export function parseManufacturingProcessKeys(input: string | null): ManufacturingProcessKey[] {
  if (!input) return [];
  const raw = input.trim();
  if (!raw) return [];

  // Preferred (new) format: comma-separated process keys, e.g. "cnc,3dp"
  const csvKeys = raw
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(
      (v): v is ManufacturingProcessKey =>
        v === "cnc" || v === "3dp" || v === "sheet" || v === "injection",
    );
  if (csvKeys.length > 0) {
    return Array.from(new Set(csvKeys));
  }

  // Backfill (legacy) format: human labels stored in the same column.
  const legacy = raw.toLowerCase();
  const keys: ManufacturingProcessKey[] = [];
  if (legacy.includes("cnc")) keys.push("cnc");
  if (legacy.includes("3d") || legacy.includes("3dp") || legacy.includes("printing") || legacy.includes("additive")) {
    keys.push("3dp");
  }
  if (legacy.includes("sheet")) keys.push("sheet");
  if (legacy.includes("injection") || legacy.includes("mold")) keys.push("injection");
  return Array.from(new Set(keys));
}

export function formatMatchedForText(processes: ManufacturingProcessKey[] | null | undefined): string | null {
  const unique = Array.from(new Set((processes ?? []).filter(Boolean)));
  if (unique.length === 0) return null;

  if (unique.length === 1) {
    switch (unique[0]) {
      case "cnc":
        return "Matched for CNC capability";
      case "sheet":
        return "Matched for sheet metal process";
      case "3dp":
        return "Matched for 3DP capability";
      case "injection":
        return "Matched for injection molding process";
    }
  }

  const labels = unique.map(getManufacturingProcessLabel);
  return `Matched for ${labels.join(", ")}`;
}

