import type { QuoteWithUploadsRow } from "@/server/quotes/types";

export type QuoteContactInfo = Pick<
  QuoteWithUploadsRow,
  "id" | "file_name" | "company" | "customer_name" | "email" | "customer_id"
>;

export type QuoteWinningContext = QuoteContactInfo &
  Pick<QuoteWithUploadsRow, "status" | "price" | "currency">;
