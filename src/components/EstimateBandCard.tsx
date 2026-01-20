import clsx from "clsx";
import { formatCurrency } from "@/lib/formatCurrency";
import { TagPill, type TagPillTone } from "@/components/shared/primitives/TagPill";
import type { PricingEstimateOutput } from "@/lib/pricing/estimate";

type EstimateBandCardProps = {
  estimate: PricingEstimateOutput | null;
  className?: string;
  unavailableHint?: string;
};

export function EstimateBandCard({
  estimate,
  className,
  unavailableHint = "Add quantity or process to improve estimates.",
}: EstimateBandCardProps) {
  const confidenceTone = estimate ? resolveConfidenceTone(estimate.confidence) : "slate";
  const confidenceLabel = estimate ? formatConfidenceLabel(estimate.confidence) : null;

  return (
    <section
      className={clsx(
        "rounded-xl border border-slate-900/60 bg-slate-950/40 px-4 py-3 text-sm text-slate-200",
        className,
      )}
      aria-label="Estimate band"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Estimate</p>
          <p className="text-xs text-slate-400">
            Estimate (not a supplier quote). Final pricing comes from supplier offers.
          </p>
        </div>
        {confidenceLabel ? (
          <TagPill size="sm" tone={confidenceTone} className="normal-case tracking-normal">
            {confidenceLabel}
          </TagPill>
        ) : null}
      </header>

      {estimate ? (
        <div className="mt-3 space-y-2">
          <p className="text-lg font-semibold text-white">
            {formatCurrency(estimate.lowUsd)} - {formatCurrency(estimate.highUsd)}
          </p>
          <p className="text-xs text-slate-400">
            Midpoint {formatCurrency(estimate.midUsd)}
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-300">
            {estimate.explanationBullets.map((bullet, index) => (
              <li key={`${index}-${bullet}`}>{bullet}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mt-3 space-y-1">
          <p className="text-sm font-semibold text-slate-100">Estimate unavailable</p>
          <p className="text-xs text-slate-400">{unavailableHint}</p>
        </div>
      )}
    </section>
  );
}

function resolveConfidenceTone(confidence: PricingEstimateOutput["confidence"]): TagPillTone {
  if (confidence === "high") return "emerald";
  if (confidence === "medium") return "blue";
  return "amber";
}

function formatConfidenceLabel(confidence: PricingEstimateOutput["confidence"]): string {
  if (confidence === "high") return "High confidence";
  if (confidence === "medium") return "Medium confidence";
  return "Low confidence";
}
