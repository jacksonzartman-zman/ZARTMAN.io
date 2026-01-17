"use client";

import { useEffect } from "react";

export function CustomerQuoteMessagesReadMarker({
  quoteId,
  enabled,
  currentUserId,
}: {
  quoteId: string;
  enabled: boolean;
  currentUserId: string | null;
}) {
  useEffect(() => {
    if (!enabled) return;
    if (!quoteId) return;
    if (!currentUserId) return;

    void fetch("/api/quote-message-reads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quoteId }),
    }).catch(() => null);
  }, [enabled, quoteId, currentUserId]);

  return null;
}
