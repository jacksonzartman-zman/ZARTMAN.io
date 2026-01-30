import clsx from "clsx";

export type RfqNextStepsPanelProps = {
  matchedCount?: number | null;
  typicalFirstOfferMins?: number | null;
  showNotifyRow?: boolean;
  className?: string;
};

function formatFirstOfferMinutes(mins: number | null | undefined): string | null {
  if (typeof mins !== "number" || !Number.isFinite(mins)) return null;
  const v = Math.max(0, Math.floor(mins));
  if (v <= 0) return "<1";
  return String(v);
}

function roundUpToNearestFiveMins(mins: number | null | undefined): number | null {
  if (typeof mins !== "number" || !Number.isFinite(mins)) return null;
  const v = Math.max(0, Math.floor(mins));
  if (v <= 0) return 5;
  return Math.max(5, Math.ceil(v / 5) * 5);
}

export function RfqNextStepsPanel({
  matchedCount,
  typicalFirstOfferMins,
  showNotifyRow,
  className,
}: RfqNextStepsPanelProps) {
  const matched =
    typeof matchedCount === "number" && Number.isFinite(matchedCount) ? Math.max(0, Math.floor(matchedCount)) : null;
  const trustMatchedSuffix =
    matched !== null && matched > 0 ? ` Matched with ${matched} partner${matched === 1 ? "" : "s"}.` : "";

  const minsLabel = formatFirstOfferMinutes(typicalFirstOfferMins);
  const firstOfferLabel = minsLabel ? `Typical first offer: ~${minsLabel} min` : "Typical first offer: minutes";

  const reassuranceMins = roundUpToNearestFiveMins(typicalFirstOfferMins);
  const reassuranceLabel =
    reassuranceMins !== null ? `Most suppliers respond within ~${reassuranceMins} minutes.` : null;

  const notifyVisible = Boolean(showNotifyRow);

  return (
    <section
      className={clsx(
        "rounded-2xl border border-slate-900/60 bg-slate-950/30 px-4 py-4 shadow-[0_18px_50px_rgba(2,6,23,0.25)]",
        className,
      )}
      aria-labelledby="rfq-next-steps-title"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-ink-soft">What happens next</p>
          <h2 id="rfq-next-steps-title" className="sr-only">
            What happens next
          </h2>
        </div>
      </header>

      <ul className="mt-3 space-y-2" role="list">
        <li className="flex items-start gap-3">
          <RowIcon variant="network" />
          <p className="text-sm text-ink">Matching with manufacturing partners</p>
        </li>
        <li className="flex items-start gap-3">
          <RowIcon variant="clock" />
          <div>
            <p className="text-sm text-ink">
              <span className={clsx(minsLabel && "tabular-nums")}>{firstOfferLabel}</span>
            </p>
            {reassuranceLabel ? <p className="mt-1 text-xs text-ink-soft">{reassuranceLabel}</p> : null}
          </div>
        </li>
        {notifyVisible ? (
          <li className="flex items-start gap-3">
            <RowIcon variant="bell" />
            <p className="text-sm text-ink">We’ll notify you when offers arrive</p>
          </li>
        ) : null}
      </ul>

      <p className="mt-3 border-t border-slate-900/60 pt-2 text-[12px] text-ink opacity-80">
        Quotes are provided by verified manufacturing partners.
        <span className={clsx(trustMatchedSuffix && "tabular-nums")}>{trustMatchedSuffix}</span>
      </p>
    </section>
  );
}

function RowIcon({ variant }: { variant: "network" | "clock" | "bell" }) {
  const common = "mt-0.5 h-5 w-5 shrink-0 text-ink-soft";
  if (variant === "clock") {
    return (
      <svg viewBox="0 0 20 20" fill="none" className={common} aria-hidden="true">
        <path
          d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <path
          d="M10 5.5v4.7l3.2 1.8"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (variant === "bell") {
    return (
      <svg viewBox="0 0 20 20" fill="none" className={common} aria-hidden="true">
        <path
          d="M10 18a2.2 2.2 0 0 0 2.1-1.6H7.9A2.2 2.2 0 0 0 10 18Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path
          d="M15.8 14.6H4.2c.9-1 1.4-2.3 1.4-3.7V8.7a4.4 4.4 0 0 1 8.8 0V11c0 1.4.5 2.7 1.4 3.6Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" fill="none" className={common} aria-hidden="true">
      <path
        d="M7.4 7.1a3.2 3.2 0 0 1 5.2 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M3.6 12.3a7.2 7.2 0 0 1 12.8 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M1.8 15.2a10 10 0 0 1 16.4 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

