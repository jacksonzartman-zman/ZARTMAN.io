import { supabaseServer } from "@/lib/supabaseServer";

const RFQ_STATUS_VALUES = ["draft", "open", "closed", "awarded", "cancelled"] as const;
const RFQ_FILE_TYPES = ["cad", "drawing", "spec", "other"] as const;

export type RfqStatus = (typeof RFQ_STATUS_VALUES)[number];
export type RfqFileType = (typeof RFQ_FILE_TYPES)[number];

export type RfqRecord = {
  id: string;
  customer_id: string | null;
  upload_id: string | null;
  title: string;
  description: string;
  status: RfqStatus;
  target_processes: unknown;
  target_materials: unknown;
  budget_currency: string | null;
  budget_amount: number | null;
  lead_time_days: number | null;
  created_at: string;
  updated_at: string;
};

export type RfqFileRecord = {
  id: string;
  rfq_id: string;
  storage_key: string;
  bucket_id: string | null;
  file_name: string | null;
  file_type: RfqFileType;
  created_at: string;
};

export type RfqWithStats = RfqRecord & {
  bidCount: number;
  acceptedBidId: string | null;
};

export type SupplierRfqSummary = RfqRecord & {
  myBid?: {
    id: string;
    status: string;
    price_total: number | null;
    currency: string | null;
    lead_time_days: number | null;
    notes: string | null;
  } | null;
  bidCount: number;
};

export type CreateRfqInput = {
  title: string;
  description: string;
  status?: RfqStatus;
  targetProcesses?: string[] | null;
  targetMaterials?: string[] | null;
  budgetCurrency?: string | null;
  budgetAmount?: number | string | null;
  leadTimeDays?: number | string | null;
  uploadId?: string | null;
  files?: CreateRfqFileInput[];
};

export type CreateRfqFileInput = {
  storageKey: string;
  bucketId?: string | null;
  fileName?: string | null;
  fileType?: RfqFileType | null;
};

export type CreateRfqResult = {
  rfq: RfqRecord | null;
  files: RfqFileRecord[];
  error: string | null;
};

export type ListRfqsForCustomerResult = {
  rfqs: RfqWithStats[];
  error: string | null;
};

export type ListOpenRfqsForSupplierResult = {
  rfqs: SupplierRfqSummary[];
  error: string | null;
};

export type RecordRfqEventInput = {
  rfqId: string;
  actorType: "customer" | "supplier" | "system";
  actorId?: string | null;
  eventType: string;
  payload?: Record<string, unknown> | null;
};

export async function createRfqForCustomer(
  customerId: string,
  input: CreateRfqInput,
): Promise<CreateRfqResult> {
  const normalizedCustomerId = customerId?.trim();
  const title = sanitizeText(input.title);
  const description = sanitizeText(input.description);

  if (!normalizedCustomerId) {
    return { rfq: null, files: [], error: "Customer is required." };
  }
  if (!title || !description) {
    return { rfq: null, files: [], error: "Title and description are required." };
  }

  const customerExists = await verifyCustomer(normalizedCustomerId);
  if (!customerExists) {
    return { rfq: null, files: [], error: "Customer not found." };
  }

  const status = normalizeStatus(input.status) ?? "open";
  const targetProcesses = sanitizeStringArray(input.targetProcesses);
  const targetMaterials = sanitizeStringArray(input.targetMaterials);
  const budgetAmount = normalizeNumber(input.budgetAmount);
  const leadTimeDays = normalizeInteger(input.leadTimeDays);
  const budgetCurrency = normalizeCurrency(
    input.budgetCurrency,
    budgetAmount !== null ? "USD" : null,
  );
  const payload = {
    customer_id: normalizedCustomerId,
    upload_id: input.uploadId ?? null,
    title,
    description,
    status,
    target_processes: targetProcesses.length > 0 ? targetProcesses : null,
    target_materials: targetMaterials.length > 0 ? targetMaterials : null,
    budget_currency: budgetCurrency,
    budget_amount: budgetAmount,
    lead_time_days: leadTimeDays,
  };

  const { data: rfq, error } = await supabaseServer
    .from("rfqs")
    .insert(payload)
    .select("*")
    .single<RfqRecord>();

  if (error || !rfq) {
    console.error("createRfqForCustomer: insert failed", { error, payload });
    return { rfq: null, files: [], error: "Unable to create RFQ right now." };
  }

  const filePayloads = buildFilePayloads(rfq.id, input.files ?? []);
  let createdFiles: RfqFileRecord[] = [];

  if (filePayloads.length > 0) {
    const { data: filesData, error: filesError } = await supabaseServer
      .from("rfq_files")
      .insert(filePayloads)
      .select("*");

    if (filesError) {
      console.error("createRfqForCustomer: file insert failed", {
        rfqId: rfq.id,
        error: filesError,
      });
    } else {
      createdFiles = (filesData as RfqFileRecord[]) ?? [];
    }
  }

  await recordRfqEvent({
    rfqId: rfq.id,
    actorType: "customer",
    actorId: normalizedCustomerId,
    eventType: "rfq_created",
    payload: {
      title,
      lead_time_days: leadTimeDays,
      budget_amount: budgetAmount,
      budget_currency: budgetCurrency,
    },
  });

  return { rfq, files: createdFiles, error: null };
}

export async function listRfqsForCustomer(
  customerId: string,
): Promise<ListRfqsForCustomerResult> {
  const normalizedCustomerId = customerId?.trim();
  if (!normalizedCustomerId) {
    return { rfqs: [], error: "Customer is required." };
  }

  const { data, error } = await supabaseServer
    .from("rfqs")
    .select("*")
    .eq("customer_id", normalizedCustomerId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("listRfqsForCustomer: query failed", {
      customerId: normalizedCustomerId,
      error,
    });
    return { rfqs: [], error: "Unable to load RFQs." };
  }

  const rfqs = (data as RfqRecord[]) ?? [];
  const stats = await loadBidStats(rfqs.map((rfq) => rfq.id));

  const withStats: RfqWithStats[] = rfqs.map((rfq) => ({
    ...rfq,
    bidCount: stats.get(rfq.id)?.count ?? 0,
    acceptedBidId: stats.get(rfq.id)?.acceptedBidId ?? null,
  }));

  return { rfqs: withStats, error: null };
}

export async function listOpenRfqsForSupplier(
  supplierId: string,
): Promise<ListOpenRfqsForSupplierResult> {
  const normalizedSupplierId = supplierId?.trim();
  if (!normalizedSupplierId) {
    return { rfqs: [], error: "Supplier is required." };
  }

  const { data, error } = await supabaseServer
    .from("rfqs")
    .select("*")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("listOpenRfqsForSupplier: rfq query failed", { error });
    return { rfqs: [], error: "Unable to load marketplace RFQs." };
  }

  const rfqs = (data as RfqRecord[]) ?? [];
  const rfqIds = rfqs.map((rfq) => rfq.id);
  const stats = await loadBidStats(rfqIds);
  const myBids = await loadSupplierBids(rfqIds, normalizedSupplierId);

  const summaries: SupplierRfqSummary[] = rfqs.map((rfq) => ({
    ...rfq,
    bidCount: stats.get(rfq.id)?.count ?? 0,
    myBid: myBids.get(rfq.id) ?? null,
  }));

  return { rfqs: summaries, error: null };
}

export async function recordRfqEvent(input: RecordRfqEventInput) {
  if (!input.rfqId) {
    return;
  }

  try {
    const payload = {
      rfq_id: input.rfqId,
      actor_type: input.actorType,
      actor_id: input.actorId ?? null,
      event_type: input.eventType,
      payload: input.payload ?? null,
    };

    const { error } = await supabaseServer.from("rfq_events").insert(payload);
    if (error) {
      console.error("recordRfqEvent: insert failed", { error, payload });
    }
  } catch (unexpectedError) {
    console.error("recordRfqEvent: unexpected error", unexpectedError);
  }
}

async function verifyCustomer(customerId: string): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from("customers")
    .select("id")
    .eq("id", customerId)
    .maybeSingle();

  if (error) {
    console.error("verifyCustomer: lookup failed", { customerId, error });
    return false;
  }

  return Boolean(data?.id);
}

function sanitizeText(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeStringArray(values?: string[] | null): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => sanitizeText(value)?.toLowerCase())
    .filter((value): value is string => Boolean(value));
}

function normalizeCurrency(
  value?: string | null,
  fallback: string | null = "USD",
): string | null {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toUpperCase();
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeNumber(value?: number | string | null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function normalizeInteger(value?: number | string | null): number | null {
  const numeric = normalizeNumber(value);
  if (numeric === null) {
    return null;
  }
  return Math.round(numeric);
}

function normalizeStatus(value?: RfqStatus | null): RfqStatus | null {
  if (!value) {
    return null;
  }
  return RFQ_STATUS_VALUES.includes(value) ? value : null;
}

function buildFilePayloads(
  rfqId: string,
  files: CreateRfqFileInput[],
) {
  return files
    .map((file) => {
      const storageKey = sanitizeText(file.storageKey);
      if (!storageKey) {
        return null;
      }
      const fileType = normalizeFileType(file.fileType);
      return {
        rfq_id: rfqId,
        storage_key: storageKey,
        bucket_id: file.bucketId ?? null,
        file_name: sanitizeText(file.fileName),
        file_type: fileType,
      };
    })
    .filter((value): value is {
      rfq_id: string;
      storage_key: string;
      bucket_id: string | null;
      file_name: string | null;
      file_type: RfqFileType;
    } => Boolean(value));
}

function normalizeFileType(fileType?: RfqFileType | null): RfqFileType {
  if (fileType && RFQ_FILE_TYPES.includes(fileType)) {
    return fileType;
  }
  return "other";
}

async function loadBidStats(rfqIds: string[]) {
  const stats = new Map<
    string,
    {
      count: number;
      acceptedBidId: string | null;
    }
  >();

  if (rfqIds.length === 0) {
    return stats;
  }

  const { data, error } = await supabaseServer
    .from("rfq_bids")
    .select("id,rfq_id,status")
    .in("rfq_id", rfqIds);

  if (error) {
    console.error("loadBidStats: query failed", { error, rfqIds });
    return stats;
  }

  for (const row of data ?? []) {
    const rfqId = row?.rfq_id;
    if (!rfqId) {
      continue;
    }
    const current = stats.get(rfqId) ?? { count: 0, acceptedBidId: null };
    current.count += 1;
    if (row.status === "accepted") {
      current.acceptedBidId = row.id;
    }
    stats.set(rfqId, current);
  }

  return stats;
}

async function loadSupplierBids(rfqIds: string[], supplierId: string) {
  const map = new Map<string, SupplierRfqSummary["myBid"]>();
  if (rfqIds.length === 0 || !supplierId) {
    return map;
  }

  const { data, error } = await supabaseServer
    .from("rfq_bids")
    .select(
      "id,rfq_id,status,price_total,currency,lead_time_days,notes",
    )
    .in("rfq_id", rfqIds)
    .eq("supplier_id", supplierId);

  if (error) {
    console.error("loadSupplierBids: query failed", { error, supplierId });
    return map;
  }

  for (const bid of data ?? []) {
    if (bid?.rfq_id) {
      map.set(bid.rfq_id, bid as SupplierRfqSummary["myBid"]);
    }
  }

  return map;
}
