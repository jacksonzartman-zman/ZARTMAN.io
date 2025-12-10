export type QuoteFileMeta = {
  filename: string;
};

export type QuoteFileSource = {
  id: string;
  upload_id: string | null;
  file_name: string | null;
  file_names?: string[] | null;
  upload_file_names?: string[] | null;
  file_count?: number | null;
  upload_file_count?: number | null;
  files?: QuoteFileMeta[];
  fileCount?: number;
};

export type QuoteWithUploadsRow = QuoteFileSource & {
  customer_name: string | null;
  email: string | null;
  company: string | null;
  customer_id?: string | null;
  status: string | null;
  price: number | string | null;
  currency: string | null;
  target_date: string | null;
  internal_notes: string | null;
  dfm_notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  assigned_supplier_email?: string | null;
  assigned_supplier_name?: string | null;
};

export type UploadMeta = {
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  company: string | null;
  manufacturing_process: string | null;
  quantity: string | null;
  shipping_postal_code: string | null;
  export_restriction: string | null;
  rfq_reason: string | null;
  notes: string | null;
  itar_acknowledged: boolean | null;
  terms_accepted: boolean | null;
};
