export type PublicRfqOfferCardDto = {
  id: string;
  /**
   * Provider name for marketplace offers (not necessarily displayed on public pages).
   */
  providerName: string | null;
  /**
   * Optional label for external/broker offers.
   */
  sourceName: string | null;
  currency: string;
  totalPrice: number | string | null;
  leadTimeDaysMin: number | null;
  leadTimeDaysMax: number | null;
  status: string;
  receivedAt: string | null;
  /**
   * Customer-visible notes (shown on public RFQ page).
   */
  notes: string | null;
  /**
   * Decision-support highlights (already computed server-side).
   */
  isBestValue: boolean;
  isFastest: boolean;
};

