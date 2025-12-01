import type { SupplierMessageFormState } from "@/app/(portals)/supplier/quotes/[id]/actions";

export const INITIAL_SUPPLIER_MESSAGE_STATE: SupplierMessageFormState = {
  ok: true,
  message: "",
  error: "",
  fieldErrors: {},
};
