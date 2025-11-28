export function normalizePriceValue(
  price: number | string | null | undefined,
): number | null {
  if (price == null) {
    return null;
  }

  const parsed = typeof price === "number" ? price : Number(price);
  return Number.isFinite(parsed) ? parsed : null;
}
