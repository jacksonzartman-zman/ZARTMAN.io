"use server";

import {
  submitSupplierBidImpl,
  postSupplierMessageImpl,
  completeKickoffTaskImpl,
  type SupplierBidFormState,
  type SupplierMessageFormState,
  type SupplierKickoffFormState,
  type ToggleSupplierKickoffTaskInput,
} from "@/server/quotes/supplierQuoteServer";

export type {
  SupplierBidFormState,
  SupplierMessageFormState,
  SupplierKickoffFormState,
};

export async function submitSupplierBid(
  _prevState: SupplierBidFormState,
  formData: FormData,
): Promise<SupplierBidFormState> {
  return submitSupplierBidImpl(formData);
}

export async function postSupplierMessage(
  quoteId: string,
  _prevState: SupplierMessageFormState,
  formData: FormData,
): Promise<SupplierMessageFormState> {
  return postSupplierMessageImpl(quoteId, formData);
}

export async function completeKickoffTask(
  input: ToggleSupplierKickoffTaskInput,
): Promise<SupplierKickoffFormState> {
  return completeKickoffTaskImpl(input);
}
