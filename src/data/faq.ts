export type FaqItem = {
  question: string;
  answer: string;
};

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: "Who sees my CAD files and search requests?",
    answer:
      "We only share your search requests and files with suppliers we've matched to your project. No public job boards or blast lists.",
  },
  {
    question: "Do I have to award every search request?",
    answer:
      "No. Compare quotes and move forward only when you're comfortable with price, lead time, and supplier fit.",
  },
  {
    question: "What if a supplier ghosts or misses a date?",
    answer:
      "We monitor activity in your workspace and can reroute jobs or bring in another supplier if something goes sideways.",
  },
  {
    question: "How do suppliers get paid?",
    answer:
      "Once you award a winner, you pay your supplier directly based on the terms you agree to together.",
  },
];
