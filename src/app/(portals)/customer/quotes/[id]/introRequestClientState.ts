export const INTRO_REQUESTED_EVENT = "customer:intro_requested";

export type IntroRequestedState = {
  quoteId: string;
  providerId: string;
  offerId: string;
  supplierName: string;
  requestedAt: string;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function buildIntroRequestedStorageKey(quoteId: string): string {
  return `customer:introRequested:${quoteId}`;
}

export function loadIntroRequestedState(quoteId: string): IntroRequestedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(buildIntroRequestedStorageKey(quoteId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<IntroRequestedState> | null;
    const parsedQuoteId = normalizeString(parsed?.quoteId);
    if (parsedQuoteId !== quoteId) return null;
    const providerId = normalizeString(parsed?.providerId);
    const offerId = normalizeString(parsed?.offerId);
    const supplierName = normalizeString(parsed?.supplierName);
    const requestedAt = normalizeString(parsed?.requestedAt);
    if (!providerId || !offerId || !supplierName || !requestedAt) return null;
    return { quoteId, providerId, offerId, supplierName, requestedAt };
  } catch {
    return null;
  }
}

export function saveIntroRequestedState(state: IntroRequestedState) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      buildIntroRequestedStorageKey(state.quoteId),
      JSON.stringify(state),
    );
  } catch {
    // Fail-soft; session storage may be unavailable.
  }

  try {
    window.dispatchEvent(new CustomEvent<IntroRequestedState>(INTRO_REQUESTED_EVENT, { detail: state }));
  } catch {
    // Fail-soft; CustomEvent may be unavailable in some environments.
  }
}

