export const PROCESS_TAGS = [
  "CNC machining",
  "Sheet metal",
  "Fabrication",
  "3D printing",
  "Injection molding",
  "Casting",
  "Finishing",
] as const;

export const MATERIAL_TAGS = [
  "Aluminum",
  "Stainless steel",
  "Steel",
  "Titanium",
  "Copper",
  "Brass",
  "Plastics",
  "Nylon",
  "ABS",
  "Delrin",
] as const;

export type ProcessTag = (typeof PROCESS_TAGS)[number];
export type MaterialTag = (typeof MATERIAL_TAGS)[number];

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function canonicalizeProcessTag(input: string | null | undefined): ProcessTag | null {
  const v = normalizeText(input);
  if (!v) return null;

  // Keep this intentionally simple + explainable (ops dashboard + discovery tags).
  if (v.includes("cnc") || v.includes("machin")) return "CNC machining";
  if (v.includes("sheet") || v.includes("laser") || v.includes("bend")) return "Sheet metal";
  if (v.includes("fabric")) return "Fabrication";
  if (v.includes("3d") || v.includes("print") || v.includes("additive")) return "3D printing";
  if (v.includes("injection") || v.includes("mold")) return "Injection molding";
  if (v.includes("cast")) return "Casting";
  if (
    v.includes("finish") ||
    v.includes("anod") ||
    v.includes("plating") ||
    v.includes("coat") ||
    v.includes("paint")
  ) {
    return "Finishing";
  }

  return null;
}

export function extractMaterialTagsFromText(input: string | null | undefined): MaterialTag[] {
  const text = normalizeText(input);
  if (!text) return [];

  const tags = new Set<MaterialTag>();

  // Direct tag name matches.
  for (const tag of MATERIAL_TAGS) {
    const key = normalizeText(tag);
    if (key && text.includes(key)) {
      tags.add(tag);
    }
  }

  // A few high-signal synonyms / common grade hints (best-effort).
  if (/(6061|7075|2024|alum)/i.test(text)) tags.add("Aluminum");
  if (/(304|316|stainless)/i.test(text)) tags.add("Stainless steel");
  if (/(steel|mild steel|carbon steel)/i.test(text)) tags.add("Steel");
  if (/(ti-?6al-?4v|titanium)/i.test(text)) tags.add("Titanium");
  if (/(copper|cu\b)/i.test(text)) tags.add("Copper");
  if (/(brass)/i.test(text)) tags.add("Brass");
  if (/(delrin|acetal)/i.test(text)) tags.add("Delrin");
  if (/(abs\b)/i.test(text)) tags.add("ABS");
  if (/(nylon|pa6|pa12)/i.test(text)) tags.add("Nylon");
  if (/(plastic|plastics)/i.test(text)) tags.add("Plastics");

  return Array.from(tags);
}

