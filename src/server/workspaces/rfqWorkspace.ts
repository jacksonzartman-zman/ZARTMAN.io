import { supabaseServer } from "@/lib/supabaseServer";
import { listBidsForRfq } from "@/server/marketplace/bids";
import { loadRfqById } from "@/server/marketplace/rfqs";
import type {
  ListBidsResult,
  MarketplaceRfq,
  MarketplaceRfqStatus,
} from "@/server/marketplace/types";

export type RfqWorkspaceViewerRole = "customer" | "supplier" | "zartman";

export type RfqCollaborationChannel = "shared" | "supplier" | "internal";

export type RfqCollaborationMessage = {
  id: string;
  rfqId: string;
  threadId: string;
  channel: RfqCollaborationChannel;
  authorRole: Exclude<RfqWorkspaceViewerRole, "zartman"> | "zartman" | "system";
  authorName: string | null;
  authorEmail: string | null;
  body: string;
  createdAt: string;
};

export type RfqCollaborationThread = {
  id: string;
  label: string;
  channel: RfqCollaborationChannel;
  participants: Array<{
    role: RfqWorkspaceViewerRole | "system";
    name: string | null;
  }>;
  messages: RfqCollaborationMessage[];
  lastActivityAt: string | null;
  totalMessages: number;
};

export type RfqWorkspaceFileAttachment = {
  id: string;
  fileName: string;
  versionLabel?: string | null;
  fileSizeBytes?: number | null;
  sourcePath?: string | null;
  uploadedAt: string | null;
  status: "available" | "processing" | "archived";
};

export type RfqWorkspaceData = {
  rfq: MarketplaceRfq;
  supplierBids: ListBidsResult["bids"];
  supplierBidError?: string | null;
  collaborationThreads: RfqCollaborationThread[];
  fileAttachments: RfqWorkspaceFileAttachment[];
  viewerRole: RfqWorkspaceViewerRole;
  lastRefreshed: string;
};

type LoadOptions = {
  viewerRole?: RfqWorkspaceViewerRole;
};

const COLLABORATION_MESSAGE_COLUMNS = [
  "id",
  "rfq_id",
  "thread_id",
  "channel",
  "author_role",
  "author_name",
  "author_email",
  "body",
  "created_at",
].join(",");

type RawCollaborationMessage = {
  id: string;
  rfq_id: string;
  thread_id: string | null;
  channel: string | null;
  author_role: string | null;
  author_name: string | null;
  author_email: string | null;
  body: string | null;
  created_at: string;
};

export async function loadRfqWorkspace(
  rfqId: string,
  options?: LoadOptions,
): Promise<RfqWorkspaceData | null> {
  if (!rfqId) {
    return null;
  }

  const rfq = await loadRfqById(rfqId);
  if (!rfq) {
    return null;
  }

  const [bidResult, threads] = await Promise.all([
    listBidsForRfq(rfqId),
    loadCollaborationThreads(rfqId),
  ]);

  const fileAttachments = deriveFileAttachments(rfq);
  const viewerRole = options?.viewerRole ?? "customer";

  return {
    rfq,
    supplierBids: bidResult.bids,
    supplierBidError: bidResult.error,
    collaborationThreads: threads,
    fileAttachments,
    viewerRole,
    lastRefreshed: new Date().toISOString(),
  };
}

async function loadCollaborationThreads(
  rfqId: string,
): Promise<RfqCollaborationThread[]> {
  if (!rfqId) {
    return [];
  }

  try {
    const { data, error } = await supabaseServer
      .from("rfq_collaboration_messages")
      .select(COLLABORATION_MESSAGE_COLUMNS)
      .eq("rfq_id", rfqId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("rfqWorkspace: failed to load collaboration messages", {
        rfqId,
        error,
      });
      return [];
    }

    const rows = Array.isArray(data)
      ? (data as RawCollaborationMessage[])
      : [];
    return groupMessagesIntoThreads(rows);
  } catch (error) {
    console.error("rfqWorkspace: unexpected error loading messages", {
      rfqId,
      error,
    });
    return [];
  }
}

function groupMessagesIntoThreads(
  rows: RawCollaborationMessage[],
): RfqCollaborationThread[] {
  if (rows.length === 0) {
    return [];
  }

  const messagesByThread = rows.reduce<Record<string, RawCollaborationMessage[]>>(
    (acc, row) => {
      const threadId = row.thread_id ?? "shared";
      acc[threadId] = acc[threadId] ?? [];
      acc[threadId].push(row);
      return acc;
    },
    {},
  );

  return Object.entries(messagesByThread).map(([threadId, threadMessages]) => {
    const channel = normalizeChannel(threadMessages[0]?.channel);
    const participants = collectParticipants(threadMessages);
    const mappedMessages = threadMessages.map((message) => ({
      id: message.id,
      rfqId: message.rfq_id,
      threadId,
      channel,
      authorRole: normalizeAuthorRole(message.author_role),
      authorName: message.author_name,
      authorEmail: message.author_email,
      body: message.body ?? "",
      createdAt: message.created_at,
    }));
    const lastActivityAt =
      threadMessages[threadMessages.length - 1]?.created_at ?? null;

    return {
      id: threadId,
      label:
        channel === "internal"
          ? "Internal thread"
          : channel === "supplier"
            ? "Supplier coordination"
            : "Shared updates",
      channel,
      participants,
      messages: mappedMessages,
      lastActivityAt,
      totalMessages: mappedMessages.length,
    };
  });
}

function deriveFileAttachments(
  rfq: MarketplaceRfq,
): RfqWorkspaceFileAttachment[] {
  const files = Array.isArray(rfq.files) ? rfq.files : [];

  if (files.length === 0) {
    return [];
  }

  return files.map((file, index) => {
    const sourcePath = typeof file === "string" ? file : null;
    const fileName = sourcePath
      ? sourcePath.split("/").pop() ?? `Attachment ${index + 1}`
      : `Attachment ${index + 1}`;

    return {
      id: `${rfq.id}:file:${index}`,
      fileName,
      versionLabel: `v${index + 1}`,
      fileSizeBytes: null,
      sourcePath,
      uploadedAt: rfq.updated_at ?? rfq.created_at ?? null,
      status: "available",
    };
  });
}

function normalizeChannel(input: string | null | undefined): RfqCollaborationChannel {
  if (input === "supplier" || input === "internal") {
    return input;
  }
  return "shared";
}

function normalizeAuthorRole(
  input: string | null | undefined,
): RfqCollaborationMessage["authorRole"] {
  const normalized = (input ?? "").trim().toLowerCase();
  if (normalized === "customer" || normalized === "supplier") {
    return normalized;
  }
  if (normalized === "zartman") {
    return "zartman";
  }
  return "system";
}

function collectParticipants(
  messages: RawCollaborationMessage[],
): RfqCollaborationThread["participants"] {
  const seen = new Map<string, RfqCollaborationThread["participants"][number]>();

  messages.forEach((message) => {
    const role = normalizeAuthorRole(message.author_role);
    const key = `${role}:${message.author_email ?? message.author_name ?? ""}`;
    if (!seen.has(key)) {
      seen.set(key, {
        role,
        name: message.author_name,
      });
    }
  });

  return Array.from(seen.values());
}

export const RFQ_WORKSPACE_EXAMPLE_PAYLOAD: RfqWorkspaceData = {
  rfq: {
    id: "rfq_demo_001",
    customer_id: "cust_demo_001",
    status: "in_review" as MarketplaceRfqStatus,
    title: "Gearbox Housing Rev B",
    description: "5-axis billet housing, low-volume pilot run (25 units).",
    quantity: 25,
    process_requirements: ["5-axis CNC", "anodize clear"],
    material_requirements: ["6061-T6"],
    certification_requirements: ["ISO 9001"],
    target_date: "2025-12-12T00:00:00.000Z",
    created_at: "2025-11-01T12:00:00.000Z",
    updated_at: "2025-11-24T18:15:00.000Z",
    priority: 0.72,
    files: [
      "rfqs/rfq_demo_001/rev-a.zip",
      "rfqs/rfq_demo_001/rev-b.zip",
    ],
    upload_id: null,
  },
  supplierBids: [
    {
      id: "bid_demo_001",
      rfq_id: "rfq_demo_001",
      supplier_id: "sup_northwind",
      price_total: 48250,
      currency: "USD",
      lead_time_days: 21,
      notes: "Includes tooling refresh + bead blast finish.",
      status: "submitted",
      created_at: "2025-11-22T09:30:00.000Z",
      updated_at: "2025-11-22T09:30:00.000Z",
      supplier: {
        id: "sup_northwind",
        company_name: "Northwind Precision",
        primary_email: "hello@northwind.example",
      },
    },
    {
      id: "bid_demo_002",
      rfq_id: "rfq_demo_001",
      supplier_id: "sup_cascade",
      price_total: 45100,
      currency: "USD",
      lead_time_days: 26,
      notes: "Lead time assumes anodize slot Tuesday/Thursday.",
      status: "submitted",
      created_at: "2025-11-23T14:10:00.000Z",
      updated_at: "2025-11-23T14:10:00.000Z",
      supplier: {
        id: "sup_cascade",
        company_name: "Cascade Proto Labs",
        primary_email: "quotes@cascade.example",
      },
    },
  ],
  supplierBidError: null,
  collaborationThreads: [
    {
      id: "shared",
      label: "Shared updates",
      channel: "shared",
      participants: [
        { role: "zartman", name: "Alex @ Zartman" },
        { role: "customer", name: "Bridget (AeroDrive)" },
        { role: "supplier", name: "Northwind PM" },
      ],
      messages: [
        {
          id: "msg_demo_001",
          rfqId: "rfq_demo_001",
          threadId: "shared",
          channel: "shared",
          authorRole: "zartman",
          authorName: "Alex @ Zartman",
          authorEmail: "alex@zartman.io",
          body: "Invited Northwind + Cascade. Expect first price bands Monday.",
          createdAt: "2025-11-21T16:05:00.000Z",
        },
        {
          id: "msg_demo_002",
          rfqId: "rfq_demo_001",
          threadId: "shared",
          channel: "shared",
          authorRole: "customer",
          authorName: "Bridget (AeroDrive)",
          authorEmail: "bridget@aerodrive.example",
          body: "Great. Priority is accuracy on bore concentricity. Files vB are final.",
          createdAt: "2025-11-21T17:02:00.000Z",
        },
      ],
      lastActivityAt: "2025-11-21T17:02:00.000Z",
      totalMessages: 2,
    },
    {
      id: "internal",
      label: "Internal thread",
      channel: "internal",
      participants: [
        { role: "zartman", name: "Alex @ Zartman" },
        { role: "zartman", name: "Priya (Supply Ops)" },
      ],
      messages: [
        {
          id: "msg_demo_003",
          rfqId: "rfq_demo_001",
          threadId: "internal",
          channel: "internal",
          authorRole: "zartman",
          authorName: "Priya (Supply Ops)",
          authorEmail: "priya@zartman.io",
          body: "Holding a third shop in reserve in case we need faster turn.",
          createdAt: "2025-11-22T11:11:00.000Z",
        },
      ],
      lastActivityAt: "2025-11-22T11:11:00.000Z",
      totalMessages: 1,
    },
  ],
  fileAttachments: [
    {
      id: "rfq_demo_001:file:0",
      fileName: "rev-a.zip",
      versionLabel: "v1",
      fileSizeBytes: 2_048_000,
      sourcePath: "rfqs/rfq_demo_001/rev-a.zip",
      uploadedAt: "2025-11-10T10:00:00.000Z",
      status: "archived",
    },
    {
      id: "rfq_demo_001:file:1",
      fileName: "rev-b.zip",
      versionLabel: "v2",
      fileSizeBytes: 2_240_000,
      sourcePath: "rfqs/rfq_demo_001/rev-b.zip",
      uploadedAt: "2025-11-18T15:45:00.000Z",
      status: "available",
    },
  ],
  viewerRole: "customer",
  lastRefreshed: "2025-11-24T18:15:00.000Z",
};
