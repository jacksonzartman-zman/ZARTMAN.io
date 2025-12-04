type DataFallbackNoticeProps = {
  className?: string;
};

export function DataFallbackNotice({ className }: DataFallbackNoticeProps) {
  const classes = ["text-xs text-slate-500", className]
    .filter(Boolean)
    .join(" ");

  return (
    <p className={classes}>
      Data failed to load – check logs for details.
    </p>
  );
}
