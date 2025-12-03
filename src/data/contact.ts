export const CONTACT_FOCUS_VALUES = [
  "buying",
  "supplying",
  "both",
] as const;

export type ContactFocusValue = (typeof CONTACT_FOCUS_VALUES)[number];

export const CONTACT_FOCUS_OPTIONS: { value: ContactFocusValue; label: string }[] = [
  { value: "buying", label: "Mostly buying" },
  { value: "supplying", label: "Mostly supplying" },
  { value: "both", label: "Both buying and supplying" },
];
