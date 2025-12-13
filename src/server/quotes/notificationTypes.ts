import type { QuoteWithUploadsRow } from "@/server/quotes/types";

export type QuoteContactInfo = Pick<
  QuoteWithUploadsRow,
  | "id"
  | "file_name"
  | "company"
  | "customer_name"
  | "customer_email"
  | "file_names"
  | "upload_file_names"
  | "file_count"
  | "upload_file_count"
>;

export type QuoteWinningContext = QuoteContactInfo &
  Pick<QuoteWithUploadsRow, "status" | "price" | "currency">;
