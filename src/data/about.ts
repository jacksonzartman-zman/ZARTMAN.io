export type TeamMember = {
  name: string;
  role: string;
  bio: string;
};

export const TEAM_MEMBERS: TeamMember[] = [
  {
    name: "Jackson Zartman",
    role: "Founder, Zartman.io",
    bio:
      "Jackson has spent the past decade running search request desks, partnering with machine shops across the U.S., and helping digital factories keep complex builds on track. He knows the back-and-forth between buyers and suppliers because he's lived it from both sides. Zartman.io exists to give that quoting scramble a calmer system without losing the human judgement that wins work.",
  },
];

export const BUYER_SUPPORT_POINTS: string[] = [
  "Private search requests routed to a vetted, curated supplier bench",
  "Hands-on help with DFM reviews and award decisions when work stalls",
  "No obligation to award—move forward only when price, lead time, and fit align",
];

export const SUPPLIER_SUPPORT_POINTS: string[] = [
  "Right-fit search requests that match your machines and capacity, not random spam",
  "Room to ask clarification questions before quoting",
  "Visibility into awards and feedback so you always know where you stand",
];

export const LOOKING_AHEAD_POINTS: string[] = [
  "Better matching signals between buyer intent, part geometry, and supplier capacity",
  "More automation around search request intake, quote reminders, and follow-ups",
  "Humans stay in the loop for tricky DFM calls and supplier relationships",
];
