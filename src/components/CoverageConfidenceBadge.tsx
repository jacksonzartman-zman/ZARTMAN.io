import { TagPill } from "@/components/shared/primitives/TagPill";
import type { CoverageConfidenceSummary } from "@/server/customer/coverageConfidence";

export function CoverageConfidenceBadge({
  summary,
  size = "sm",
  className,
}: {
  summary: CoverageConfidenceSummary;
  size?: "sm" | "md";
  className?: string;
}) {
  const tone =
    summary.level === "strong"
      ? "emerald"
      : summary.level === "moderate"
        ? "blue"
        : "amber";

  return (
    <TagPill
      size={size}
      tone={tone}
      className={className}
      title={summary.helper}
      aria-label={`Coverage confidence: ${summary.label}`}
    >
      {summary.label}
    </TagPill>
  );
}

