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

export const submitSupplierBid = async (
  _prevState: SupplierBidFormState,
  formData: FormData,
): Promise<SupplierBidFormState> => {
  return submitSupplierBidImpl(formData);
};

export const postSupplierMessage = async (
  quoteId: string,
  _prevState: SupplierMessageFormState,
  formData: FormData,
): Promise<SupplierMessageFormState> => {
  return postSupplierMessageImpl(quoteId, formData);
};

export const completeKickoffTask = async (
  input: ToggleSupplierKickoffTaskInput,
): Promise<SupplierKickoffFormState> => {
  return completeKickoffTaskImpl(input);
};
