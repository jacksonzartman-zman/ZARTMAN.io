import type { QuoteWithUploadsRow } from "@/server/quotes/types";
import type { FairnessScore } from "@/lib/fairness";

export type SupplierRow = {
  id: string;
  company_name: string;
  primary_email: string;
  user_id: string | null;
  phone: string | null;
  website: string | null;
  country: string | null;
  verified: boolean;
  created_at: string;
};

export type SupplierCapabilityRow = {
  id: string;
  supplier_id: string;
  process: string;
  materials: string[] | null;
  certifications: string[] | null;
  max_part_size: Record<string, unknown> | null;
  created_at: string;
};

export type SupplierDocumentRow = {
  id: string;
  supplier_id: string;
  file_url: string;
  doc_type: string | null;
  uploaded_at: string;
};

export type SupplierBidStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "withdrawn";

export type SupplierBidRow = {
  id: string;
  quote_id: string;
  supplier_id: string;
  unit_price: number | string | null;
  currency: string | null;
  lead_time_days: number | null;
  notes: string | null;
  status: SupplierBidStatus;
  created_at: string;
  updated_at: string;
};

export type SupplierProfile = {
  supplier: SupplierRow;
  capabilities: SupplierCapabilityRow[];
  documents: SupplierDocumentRow[];
};

export type SupplierCapabilityInput = {
  id?: string;
  process: string;
  materials?: string[];
  certifications?: string[];
  maxPartSize?: {
    x?: number | null;
    y?: number | null;
    z?: number | null;
    units?: string | null;
  } | null;
};

export type SupplierProfileUpsertInput = {
  supplierId?: string;
  primaryEmail: string;
  companyName?: string | null;
  phone?: string | null;
  website?: string | null;
  country?: string | null;
  capabilities?: SupplierCapabilityInput[];
  userId?: string | null;
};

export type SupplierDocumentInput = {
  fileUrl: string;
  docType?: string | null;
};

export type SupplierBidInput = {
  quoteId: string;
  supplierId: string;
  unitPrice: number | string | null;
  currency?: string | null;
  leadTimeDays?: number | null;
  notes?: string | null;
};

export type SupplierBidWithContext = SupplierBidRow & {
  supplier?: SupplierRow | null;
  certifications?: string[];
};

export type QuoteMatchCandidate = QuoteWithUploadsRow & {
  upload_id: string | null;
};

export type SupplierQuoteMatch = {
  quoteId: string;
  quote: QuoteWithUploadsRow;
  processHint: string | null;
  materialMatches: string[];
  score: number;
  createdAt: string | null;
  quantityHint?: string | null;
  fairness?: FairnessScore;
};
