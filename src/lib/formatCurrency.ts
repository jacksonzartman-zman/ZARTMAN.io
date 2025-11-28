const DEFAULT_CURRENCY = "USD";

type FormatCurrencyOptions = Pick<
  Intl.NumberFormatOptions,
  "minimumFractionDigits" | "maximumFractionDigits"
>;

export function formatCurrency(
  value: number | null | undefined,
  currency?: string | null,
  options?: FormatCurrencyOptions,
): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }

  const resolvedCurrency = (currency ?? DEFAULT_CURRENCY).toUpperCase();
  const maximumFractionDigits = options?.maximumFractionDigits ?? 0;
  const minimumFractionDigits = options?.minimumFractionDigits ?? maximumFractionDigits;

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: resolvedCurrency,
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(value);
  } catch {
    const digits = Math.max(minimumFractionDigits, maximumFractionDigits);
    return `${resolvedCurrency} ${value.toFixed(digits)}`;
  }
}
