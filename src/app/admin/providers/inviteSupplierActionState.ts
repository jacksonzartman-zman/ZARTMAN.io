export type InviteSupplierActionState =
  | { status?: undefined }
  | { status: "success"; message: string }
  | { status: "error"; error: string };

export const INVITE_SUPPLIER_INITIAL_STATE: InviteSupplierActionState = {};

