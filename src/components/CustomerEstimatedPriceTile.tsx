import clsx from "clsx";
import { formatCurrency } from "@/lib/formatCurrency";
import { TagPill, type TagPillTone } from "@/components/shared/primitives/TagPill";
import { partsBucketFromCount, type CustomerPricingEstimateConfidence, type CustomerPricingEstimate } from "@/server/customer/pricingEstimate";

type CustomerEstimatedPriceTileProps = {
  estimate: CustomerPricingEstimate | null;
  technology: string | null;
  material: string | null;
  partsCount: number | null;
  className?: string;
};

export function CustomerEstimatedPriceTile({
  estimate,
  technology,
  material,
  partsCount,
  className,
}: CustomerEstimatedPriceTileProps) {
  if (!estimate) return null;

  const bucket = partsBucketFromCount(partsCount);
  const tooltip = buildTooltip({
    technology,
    material,
    partsBucket: bucket,
  });

  const [low, high] = estimate.p10 <= estimate.p90
    ? [estimate.p10, estimate.p90]
    : [estimate.p90, estimate.p10];

  const confidenceTone = resolveConfidenceTone(estimate.confidence);
  const confidenceLabel = formatConfidenceLabel(estimate.confidence);

  return (
    <div
      className={clsx("rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2", className)}
      title={tooltip}
    >
      <div className="flex items-start justify-between gap-2">
        <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Estimated price
        </dt>
        <TagPill size="sm" tone={confidenceTone} className="normal-case tracking-normal">
          {confidenceLabel}
        </TagPill>
      </div>
      <dd className="mt-1 text-sm font-semibold text-white tabular-nums">
        {formatCurrency(low)} – {formatCurrency(high)}
      </dd>
      <div className="mt-0.5 text-xs text-slate-400 tabular-nums">
        Typical: {formatCurrency(estimate.p50)}
      </div>
    </div>
  );
}

function resolveConfidenceTone(confidence: CustomerPricingEstimateConfidence): TagPillTone {
  if (confidence === "strong") return "emerald";
  if (confidence === "moderate") return "blue";
  if (confidence === "limited") return "amber";
  return "slate";
}

function formatConfidenceLabel(confidence: CustomerPricingEstimateConfidence): string {
  if (confidence === "strong") return "Strong";
  if (confidence === "moderate") return "Moderate";
  if (confidence === "limited") return "Limited";
  return "Unknown";
}

function buildTooltip(args: {
  technology: string | null;
  material: string | null;
  partsBucket: ReturnType<typeof partsBucketFromCount> | null;
}): string {
  const tech = normalizeText(args.technology);
  const material = normalizeText(args.material);
  const partsBucket = args.partsBucket;

  const partsLabel = formatPartsBucket(partsBucket);
  const base = tech ? `Based on similar ${tech} projects` : "Based on similar projects";
  const withMaterial = material ? `${base} + ${material}` : base;
  const withParts = partsLabel ? `${withMaterial} + ${partsLabel}` : withMaterial;
  return `${withParts}.`;
}

function normalizeText(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatPartsBucket(bucket: ReturnType<typeof partsBucketFromCount> | null): string | null {
  if (!bucket) return null;
  if (bucket === "1") return "1 part";
  return `${bucket} parts`;
}
