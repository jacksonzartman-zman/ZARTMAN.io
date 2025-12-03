export type CapabilityProcess = {
  title: string;
  description: string;
  bestFor: string[];
  notFitWhen: string;
};

export type EnvelopeSpec = {
  label: string;
  value: string;
  helper?: string;
};

export const CAPABILITY_PROCESSES: CapabilityProcess[] = [
  {
    title: "CNC machining",
    description:
      "Multi-axis milling and turning for tight-tolerance prototype and bridge builds across common alloys and plastics.",
    bestFor: [
      "Prototype and low-volume production parts that need quick DFM",
      "Aluminum, stainless, tool steels, Delrin, and similar materials",
      "Components with mixed milling/turning ops or secondary finishing",
    ],
    notFitWhen:
      "Automotive-scale volumes, massive castings, or programs that require ITAR-only facilities.",
  },
  {
    title: "Sheet metal & fabrication",
    description:
      "Forming, laser cutting, and hardware installation for enclosures, brackets, and light structural parts.",
    bestFor: [
      "Electromechanical enclosures or brackets with multiple bends",
      "Gauge thicknesses through roughly 0.25 inch",
      "Projects that benefit from quick fixture tweaks before production",
    ],
    notFitWhen:
      "Large welded structures, heavy plate fabrication, or architectural-scale assemblies.",
  },
  {
    title: "3D printing (polymer + metal)",
    description:
      "Selective laser sintering, MJF, and metal additive for complex geometries without tooling delays.",
    bestFor: [
      "Design validation parts that need fast turns",
      "Lightweight structures with internal channels or lattices",
      "Short-run spares where machining would be cost-prohibitive",
    ],
    notFitWhen:
      "Mass-market consumer plastic runs or parts larger than typical desktop-sized build envelopes.",
  },
  {
    title: "Assembly & finishing",
    description:
      "Light assembly, bead blast, anodize, chem film, paint, and inspection steps handled before shipment.",
    bestFor: [
      "Pilot builds that need hardware install or insert seating",
      "Subassemblies that benefit from pre-fit testing",
      "Parts that need cosmetic finishing alongside functional checks",
    ],
    notFitWhen:
      "Full contract manufacturing lines or highly regulated electronics assembly.",
  },
];

export const CAPABILITY_ENVELOPES: EnvelopeSpec[] = [
  {
    label: "CNC envelopes",
    value: "Tight-tolerance prototype and low-volume parts up to roughly 24\" x 24\" x 12\".",
    helper: "Larger parts welcome for review—we'll flag if they need a different bench.",
  },
  {
    label: "Sheet metal",
    value: "Formed panels and brackets up to ~36\" in the longest dimension.",
  },
  {
    label: "3D printing",
    value: "Polymer and metal builds up to about a 12\" cube with fine features near 0.010\".",
  },
  {
    label: "Typical quantities",
    value: "Single prototypes through recurring low/medium production releases.",
  },
  {
    label: "Complexity sweet spot",
    value: "Multi-op parts that need DFM collaboration more than commodity catalog work.",
  },
];

export const OUT_OF_SCOPE_NOTES = [
  "Large welded structures, heavy plate frames, or massive castings.",
  "Automotive- or aerospace-certified production that requires dedicated lines or ITAR-only facilities.",
  "Exotic materials that need bespoke sourcing (e.g., beryllium, Hastelloy) on tight turnarounds.",
  "High-volume consumer plastics or stampings where tooling amortization drives the whole business case.",
];
