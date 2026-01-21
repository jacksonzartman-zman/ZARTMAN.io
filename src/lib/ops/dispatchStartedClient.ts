export function recordDispatchStarted(input: { destinationId: string; quoteId: string }): void {
  const destinationId =
    typeof input?.destinationId === "string" ? input.destinationId.trim() : "";
  const quoteId = typeof input?.quoteId === "string" ? input.quoteId.trim() : "";
  if (!destinationId || !quoteId) return;

  try {
    void fetch("/api/ops/destinations/dispatch-started", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destinationId, quoteId }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Best-effort: ignore client failures.
  }
}
