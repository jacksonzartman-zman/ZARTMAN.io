export function recordDispatchStarted(destinationId: string): void {
  const normalized = typeof destinationId === "string" ? destinationId.trim() : "";
  if (!normalized) return;

  try {
    void fetch("/api/admin/rfq-destinations/dispatch-started", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destinationId: normalized }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Best-effort: ignore client failures.
  }
}
