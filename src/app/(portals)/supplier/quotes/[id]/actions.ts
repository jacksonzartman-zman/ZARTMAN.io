"use server";

import {
  submitSupplierBidImpl,
  postSupplierMessageImpl,
  completeKickoffTaskImpl,
  type SupplierBidFormState,
  type SupplierKickoffFormState,
  type ToggleSupplierKickoffTaskInput,
} from "@/server/quotes/supplierQuoteServer";
import type { QuoteMessageFormState } from "@/app/(portals)/components/QuoteMessagesThread.types";

export type {
  SupplierBidFormState,
  SupplierKickoffFormState,
};
export type { QuoteMessageFormState } from "@/app/(portals)/components/QuoteMessagesThread.types";

export async function submitSupplierBid(
  _prevState: SupplierBidFormState,
  formData: FormData,
): Promise<SupplierBidFormState> {
  return submitSupplierBidImpl(formData);
}

export async function postQuoteMessage(
  quoteId: string,
  _prevState: QuoteMessageFormState,
  formData: FormData,
): Promise<QuoteMessageFormState> {
  return postSupplierMessageImpl(quoteId, formData);
}

export async function completeKickoffTask(
  input: ToggleSupplierKickoffTaskInput,
): Promise<SupplierKickoffFormState> {
  return completeKickoffTaskImpl(input);
}
