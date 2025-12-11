export type AwardBidFormState = {
  status: "idle" | "success" | "error";
  message?: string | null;
  error?: string | null;
};

export const AWARD_BID_FORM_INITIAL_STATE: AwardBidFormState = {
  status: "idle",
  message: null,
  error: null,
};
