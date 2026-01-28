import { supabaseAdmin } from "@/lib/supabaseServer";
import { hasColumns, schemaGate } from "@/server/db/schemaContract";
import { isMissingTableOrColumnError, serializeSupabaseError } from "@/server/admin/logging";

type SeedResult =
  | { ok: true; quoteId: string }
  | { ok: false; error: string };

type DemoSeedContext = {
  adminUserId: string;
  adminEmail: string | null;
};

type ProviderRow = {
  id: string;
  name: string;
};

type DemoMessageSeed = {
  role: "customer" | "admin" | "supplier";
  body: string;
  senderName?: string | null;
  providerId?: string | null;
  createdAtIso: string;
};

type DemoUploadInsertPayload = {
  file_name: string;
  file_path: string;
  mime_type: string;
  name: string;
  email: string;
  company: string;
  customer_id: string;
  status: string;
};

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function getAdminClientOrThrow() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "[demo seed] SUPABASE_SERVICE_ROLE_KEY missing; demo seed requires admin client",
    );
  }
  return supabaseAdmin();
}

/**
 * Test-only helper: build the minimal uploads insert payload for demo seed.
 * Keep in sync with the schema expectations in `ensureDemoSchema`.
 */
export function buildDemoUploadInsertPayload(args: {
  customerId: string;
  customerEmail: string;
  nowIso: string;
}): DemoUploadInsertPayload {
  const customerId = normalizeId(args.customerId);
  const customerEmail = normalizeEmail(args.customerEmail) ?? "";
  const nowIso = typeof args.nowIso === "string" ? args.nowIso : "";
  const suffix = nowIso ? ` (${nowIso})` : "";
  return {
    file_name: "demo-bracket.step",
    file_path: "demo/demo-bracket.step",
    mime_type: "application/step",
    name: `Demo Customer${suffix}`,
    email: customerEmail,
    company: "Demo Corp",
    customer_id: customerId,
    status: "in_review",
  };
}

/**
 * Test-only helper: build the minimal quotes insert payload for demo seed.
 * Keep in sync with the schema expectations in `ensureDemoSchema`.
 */
export function buildDemoQuoteInsertPayload(args: {
  customerId: string;
  customerEmail: string;
  uploadId: string;
  nowIso: string;
}): Record<string, unknown> {
  const nowIso = typeof args.nowIso === "string" ? args.nowIso : "";
  return {
    upload_id: normalizeId(args.uploadId),
    customer_id: normalizeId(args.customerId),
    customer_email: normalizeEmail(args.customerEmail) ?? "",
    customer_name: "Demo Customer",
    company: "Demo Corp",
    status: "in_review",
    currency: "USD",
    file_name: "demo-bracket.step",
    internal_notes: `DEMO_MODE seed (${nowIso})`,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

async function ensureDemoSchema(): Promise<{ ok: true } | { ok: false; error: string }> {
  const checks = await Promise.all([
    schemaGate({
      enabled: true,
      relation: "customers",
      requiredColumns: ["id", "email", "company_name", "user_id"],
      warnPrefix: "[demo seed]",
      warnKey: "demo_seed:customers",
    }),
    schemaGate({
      enabled: true,
      relation: "quotes",
      requiredColumns: [
        "id",
        "upload_id",
        "customer_id",
        "customer_email",
        "customer_name",
        "company",
        "status",
        "currency",
        "file_name",
        "internal_notes",
        "created_at",
        "updated_at",
      ],
      warnPrefix: "[demo seed]",
      warnKey: "demo_seed:quotes",
    }),
    schemaGate({
      enabled: true,
      relation: "uploads",
      requiredColumns: [
        "id",
        "file_name",
        "file_path",
        "mime_type",
        "name",
        "email",
        "company",
        "customer_id",
        "status",
      ],
      warnPrefix: "[demo seed]",
      warnKey: "demo_seed:uploads",
    }),
    schemaGate({
      enabled: true,
      relation: "providers",
      requiredColumns: ["id", "name", "provider_type", "quoting_mode", "is_active"],
      warnPrefix: "[demo seed]",
      warnKey: "demo_seed:providers",
    }),
    schemaGate({
      enabled: true,
      relation: "rfq_offers",
      requiredColumns: [
        "id",
        "rfq_id",
        "provider_id",
        "currency",
        "total_price",
        "lead_time_days_min",
        "lead_time_days_max",
        "assumptions",
        "confidence_score",
        "quality_risk_flags",
        "status",
        "received_at",
        "created_at",
      ],
      warnPrefix: "[demo seed]",
      warnKey: "demo_seed:rfq_offers",
    }),
  ]);

  if (checks.every(Boolean)) return { ok: true };
  return {
    ok: false,
    error:
      "Demo seed is unavailable in this environment (missing DB tables/columns).",
  };
}

async function ensureDemoCustomer(
  admin: ReturnType<typeof supabaseAdmin>,
  ctx: DemoSeedContext,
): Promise<
  | { ok: true; customerId: string; email: string }
  | { ok: false; error: string }
> {
  const email =
    normalizeEmail(process.env.DEMO_CUSTOMER_EMAIL) ?? normalizeEmail(ctx.adminEmail);
  if (!email) {
    return { ok: false, error: "Missing demo customer email." };
  }

  try {
    const { data: existing, error: existingError } = await admin
      .from("customers")
      .select("id,email,user_id")
      .ilike("email", email)
      .maybeSingle<{ id: string; email: string; user_id: string | null }>();

    if (existingError) {
      console.error("[demo seed] customer lookup failed", {
        email,
        error: serializeSupabaseError(existingError) ?? existingError,
      });
      return { ok: false, error: "Unable to look up demo customer." };
    }

    if (existing?.id) {
      const existingUserId = normalizeId(existing.user_id);
      const adminUserId = normalizeId(ctx.adminUserId);
      const shouldAttachUser =
        normalizeEmail(ctx.adminEmail) === email &&
        isUuid(adminUserId) &&
        (!existingUserId || existingUserId === adminUserId);

      if (shouldAttachUser && existingUserId !== adminUserId) {
        const { error: updateError } = await admin
          .from("customers")
          .update({ user_id: adminUserId, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (updateError) {
          console.warn("[demo seed] failed to attach user_id to demo customer", {
            customerId: existing.id,
            email,
            error: serializeSupabaseError(updateError) ?? updateError,
          });
        }
      }

      return { ok: true, customerId: existing.id, email };
    }

    const payload: Record<string, unknown> = {
      email,
      company_name: "Demo Customer",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (normalizeEmail(ctx.adminEmail) === email && isUuid(ctx.adminUserId)) {
      payload.user_id = ctx.adminUserId;
    }

    const { data, error } = await admin
      .from("customers")
      .insert(payload)
      .select("id,email")
      .single<{ id: string; email: string }>();

    if (error || !data?.id) {
      console.error("[demo seed] customer insert failed", {
        email,
        payload,
        error: serializeSupabaseError(error) ?? error,
      });
      return { ok: false, error: "Unable to create demo customer." };
    }

    return { ok: true, customerId: data.id, email: data.email };
  } catch (error) {
    console.error("[demo seed] customer upsert crashed", {
      email,
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, error: "Unable to create demo customer." };
  }
}

async function ensureDemoProviders(
  admin: ReturnType<typeof supabaseAdmin>,
): Promise<
  | { ok: true; providers: ProviderRow[] }
  | { ok: false; error: string }
> {
  const demoProviders: Array<{
    name: string;
    provider_type: "factory" | "broker" | "marketplace" | "direct_supplier";
    quoting_mode: "manual" | "email" | "api";
    website: string;
    notes: string;
  }> = [
    {
      name: "Demo CNC Works",
      provider_type: "factory",
      quoting_mode: "email",
      website: "https://example.com/demo-cnc",
      notes: "DEMO_MODE fixture provider.",
    },
    {
      name: "Demo Sheet Metal Co",
      provider_type: "factory",
      quoting_mode: "manual",
      website: "https://example.com/demo-sheet",
      notes: "DEMO_MODE fixture provider.",
    },
    {
      name: "Demo Marketplace Partner",
      provider_type: "marketplace",
      quoting_mode: "api",
      website: "https://example.com/demo-marketplace",
      notes: "DEMO_MODE fixture provider.",
    },
  ];

  try {
    const names = demoProviders.map((p) => p.name);
    const { data: existing, error: existingError } = await admin
      .from("providers")
      .select("id,name")
      .in("name", names)
      .returns<Array<{ id: string; name: string }>>();

    if (existingError) {
      console.error("[demo seed] provider lookup failed", {
        error: serializeSupabaseError(existingError) ?? existingError,
      });
      return { ok: false, error: "Unable to load providers for demo seed." };
    }

    const existingByName = new Map<string, ProviderRow>();
    for (const row of existing ?? []) {
      const id = normalizeId(row?.id);
      const name = typeof row?.name === "string" ? row.name.trim() : "";
      if (id && name) {
        existingByName.set(name, { id, name });
      }
    }

    const missing = demoProviders.filter((p) => !existingByName.has(p.name));
    if (missing.length > 0) {
      const { data: inserted, error: insertError } = await admin
        .from("providers")
        .insert(
          missing.map((p) => ({
            name: p.name,
            provider_type: p.provider_type,
            quoting_mode: p.quoting_mode,
            is_active: true,
            verification_status: "verified",
            website: p.website,
            notes: p.notes,
            created_at: new Date().toISOString(),
          })),
        )
        .select("id,name")
        .returns<Array<{ id: string; name: string }>>();

      if (insertError) {
        console.error("[demo seed] provider insert failed", {
          error: serializeSupabaseError(insertError) ?? insertError,
        });
        return { ok: false, error: "Unable to create providers for demo seed." };
      }

      for (const row of inserted ?? []) {
        const id = normalizeId(row?.id);
        const name = typeof row?.name === "string" ? row.name.trim() : "";
        if (id && name) {
          existingByName.set(name, { id, name });
        }
      }
    }

    const providers = demoProviders
      .map((p) => existingByName.get(p.name) ?? null)
      .filter((p): p is ProviderRow => Boolean(p));

    if (providers.length < 2) {
      return { ok: false, error: "Unable to resolve demo providers." };
    }

    // Demo UX: customer portal hides unverified providers. Ensure demo providers are
    // active + verified so seeded offers always appear.
    const canUpdateVerification = await schemaGate({
      enabled: true,
      relation: "providers",
      requiredColumns: ["id", "is_active", "verification_status"],
      warnPrefix: "[demo seed]",
      warnKey: "demo_seed:providers_verification",
    });
    if (canUpdateVerification) {
      const providerIds = providers.map((p) => p.id).filter(Boolean);
      if (providerIds.length > 0) {
        try {
          const { error: updateError } = await admin
            .from("providers")
            .update({ is_active: true, verification_status: "verified" })
            .in("id", providerIds);
          if (updateError) {
            console.warn("[demo seed] provider verification update failed; continuing", {
              error: serializeSupabaseError(updateError) ?? updateError,
            });
          }
        } catch (error) {
          console.warn("[demo seed] provider verification update crashed; continuing", {
            error: serializeSupabaseError(error) ?? error,
          });
        }
      }
    }

    return { ok: true, providers };
  } catch (error) {
    console.error("[demo seed] provider ensure crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, error: "Unable to create providers for demo seed." };
  }
}

export async function seedDemoSearchRequest(ctx: DemoSeedContext): Promise<SeedResult> {
  const gitSha = process.env.VERCEL_GIT_COMMIT_SHA || "unknown";
  const vercelEnv = process.env.VERCEL_ENV || "unknown";
  console.error(
    `[demo seed] handler start fn=seedDemoSearchRequest gitSha=${gitSha} vercelEnv=${vercelEnv}`,
  );

  let admin: ReturnType<typeof supabaseAdmin>;
  try {
    admin = getAdminClientOrThrow();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Demo seed requires admin client.";
    console.error("[demo seed] admin client unavailable", {
      gitSha,
      vercelEnv,
      error: message,
    });
    return { ok: false, error: message };
  }

  const schema = await ensureDemoSchema();
  if (!schema.ok) return schema;

  const customer = await ensureDemoCustomer(admin, ctx);
  if (!customer.ok) return customer;

  const providersResult = await ensureDemoProviders(admin);
  if (!providersResult.ok) return providersResult;

  const nowIso = new Date().toISOString();

  try {
    const uploadPayload = buildDemoUploadInsertPayload({
      customerId: customer.customerId,
      customerEmail: customer.email,
      nowIso,
    });

    const uploadInsert = await admin
      .from("uploads")
      .insert(uploadPayload)
      .select("id")
      .single<{ id: string }>();

    if (uploadInsert.error || !uploadInsert.data?.id) {
      console.error("[demo seed] upload insert failed", {
        customerId: customer.customerId,
        customerEmail: customer.email,
        payloadFields: Object.keys(uploadPayload),
        payload: uploadPayload,
        error: serializeSupabaseError(uploadInsert.error) ?? uploadInsert.error,
      });
      return { ok: false, error: "Unable to create demo upload." };
    }

    const uploadId = uploadInsert.data.id;
    if (!isUuid(uploadId)) {
      console.error("[demo seed] upload insert failed", {
        reason: "upload insert returned non-uuid id",
        uploadId,
        payloadFields: Object.keys(uploadPayload),
      });
      return { ok: false, error: "Unable to create demo upload." };
    }

    console.error("[demo seed] UPLOAD INSERTED", { gitSha, vercelEnv, uploadId });

    const demoQuotePayloadBase = buildDemoQuoteInsertPayload({
      customerId: customer.customerId,
      customerEmail: customer.email,
      uploadId,
      nowIso,
    });

    const quoteInsertPayload: any = { ...demoQuotePayloadBase, upload_id: uploadId };
    console.error("[demo seed] PRE-INSERT QUOTE", {
      gitSha,
      vercelEnv,
      uploadId,
      payloadKeys: Object.keys(quoteInsertPayload),
      payloadUploadId: (quoteInsertPayload as any).upload_id,
    });

    const { data: quote, error: quoteError } = await admin
      .from("quotes")
      .insert(quoteInsertPayload)
      .select("id")
      .single<{ id: string }>();

    if (quoteError || !quote?.id) {
      console.error("[demo seed] quote insert failed", {
        uploadId,
        payloadFields: Object.keys(quoteInsertPayload),
        payload: quoteInsertPayload,
        error: serializeSupabaseError(quoteError) ?? quoteError,
      });
      return { ok: false, error: "Unable to create demo quote." };
    }

    console.log("[demo seed] quote inserted", { quoteId: quote.id, uploadId });

    // Phase 18.3: best-effort seeded thread messages (never block quote creation).
    await seedDemoQuoteMessagesBestEffort({
      admin,
      quoteId: quote.id,
      ctx,
      providers: providersResult.providers,
      nowIso,
    });

    const destinationIdByProviderId = new Map<string, string>();
    const destinationsSupported = await schemaGate({
      enabled: true,
      relation: "rfq_destinations",
      requiredColumns: [
        "id",
        "rfq_id",
        "provider_id",
        "status",
        "sent_at",
        "last_status_at",
        "created_at",
        "offer_token",
      ],
      warnPrefix: "[demo seed]",
      warnKey: "demo_seed:rfq_destinations",
    });
    if (destinationsSupported) {
      try {
        const destinationPayload = providersResult.providers.slice(0, 3).map((provider) => ({
          rfq_id: quote.id,
          provider_id: provider.id,
          status: "quoted",
          sent_at: nowIso,
          last_status_at: nowIso,
          offer_token: `demo-${quote.id}-${provider.id}`,
          created_at: nowIso,
        }));

        const { data: insertedDestinations, error: destinationsError } = await admin
          .from("rfq_destinations")
          .insert(destinationPayload)
          .select("id,provider_id")
          .returns<Array<{ id: string; provider_id: string }>>();

        if (destinationsError) {
          console.warn("[demo seed] destinations insert failed; continuing without destinations", {
            quoteId: quote.id,
            error: serializeSupabaseError(destinationsError) ?? destinationsError,
          });
        } else {
          for (const row of insertedDestinations ?? []) {
            const destinationId = normalizeId(row?.id);
            const providerId = normalizeId(row?.provider_id);
            if (destinationId && providerId) {
              destinationIdByProviderId.set(providerId, destinationId);
            }
          }
        }
      } catch (destinationsError) {
        console.warn("[demo seed] destinations insert crashed; continuing without destinations", {
          quoteId: quote.id,
          error: serializeSupabaseError(destinationsError) ?? destinationsError,
        });
      }
    }

    const demoOffers = [
      {
        provider: providersResult.providers[0]!,
        total_price: 1450,
        lead_time_days_min: 7,
        lead_time_days_max: 10,
        confidence_score: 92,
        quality_risk_flags: [] as string[],
        assumptions: "Includes basic deburr. Excludes anodize.",
      },
      {
        provider: providersResult.providers[1]!,
        total_price: 1195,
        lead_time_days_min: 12,
        lead_time_days_max: 16,
        confidence_score: 78,
        quality_risk_flags: ["long_lead_time"],
        assumptions: "Material subject to availability. Standard tolerances.",
      },
      {
        provider: providersResult.providers[2] ?? providersResult.providers[0]!,
        total_price: 1690,
        lead_time_days_min: 5,
        lead_time_days_max: 7,
        confidence_score: 88,
        quality_risk_flags: ["expedited"],
        assumptions: "Expedite fee included. Shipping billed at cost.",
      },
    ].slice(0, 3);

    const offerPayload = demoOffers.map((offer) => ({
      rfq_id: quote.id,
      provider_id: offer.provider.id,
      destination_id: destinationIdByProviderId.get(offer.provider.id) ?? null,
      currency: "USD",
      total_price: offer.total_price,
      unit_price: null,
      tooling_price: null,
      shipping_price: null,
      lead_time_days_min: offer.lead_time_days_min,
      lead_time_days_max: offer.lead_time_days_max,
      assumptions: offer.assumptions,
      confidence_score: offer.confidence_score,
      quality_risk_flags: offer.quality_risk_flags,
      status: "received",
      received_at: nowIso,
      created_at: nowIso,
    }));

    const { error: offersError } = await admin
      .from("rfq_offers")
      .insert(offerPayload);

    if (offersError) {
      console.error("[demo seed] offers insert failed", {
        quoteId: quote.id,
        error: serializeSupabaseError(offersError) ?? offersError,
      });
      try {
        const { error: cleanupError } = await admin
          .from("quotes")
          .delete()
          .eq("id", quote.id);
        if (cleanupError) {
          console.warn("[demo seed] cleanup failed after offers insert error", {
            quoteId: quote.id,
            error: serializeSupabaseError(cleanupError) ?? cleanupError,
          });
        }
      } catch (cleanupError) {
        console.warn("[demo seed] cleanup crashed after offers insert error", {
          quoteId: quote.id,
          error: serializeSupabaseError(cleanupError) ?? cleanupError,
        });
      }
      return {
        ok: false,
        error: "Failed to create demo offers.",
      };
    }

    return { ok: true, quoteId: quote.id };
  } catch (error) {
    console.error("[demo seed] seed crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
    return { ok: false, error: "Demo seed failed unexpectedly." };
  }
}

function shiftIso(baseIso: string, deltaMs: number): string {
  const base = Date.parse(baseIso);
  if (!Number.isFinite(base)) return new Date().toISOString();
  return new Date(base + deltaMs).toISOString();
}

async function seedDemoQuoteMessagesBestEffort(args: {
  admin: ReturnType<typeof supabaseAdmin>;
  quoteId: string;
  ctx: DemoSeedContext;
  providers: ProviderRow[];
  nowIso: string;
}): Promise<void> {
  const quoteId = normalizeId(args.quoteId);
  if (!quoteId) return;

  // If the `quote_messages` relation is missing, skip quietly.
  const hasAnySchema = await schemaGate({
    enabled: true,
    relation: "quote_messages",
    requiredColumns: ["quote_id", "created_at"],
    warnPrefix: "[demo seed]",
    warnKey: "demo_seed:quote_messages",
  });
  if (!hasAnySchema) return;

  // Determine schema flavor.
  const hasNewSchema = await hasColumns("quote_messages", ["message", "author_role"]);
  const hasLegacySchema = await hasColumns("quote_messages", ["body", "sender_role", "sender_id"]);
  if (!hasNewSchema && !hasLegacySchema) {
    return;
  }

  const providerWinner = args.providers?.[0] ?? null;
  const providerId = providerWinner ? normalizeId(providerWinner.id) : "";
  const providerName = providerWinner ? providerWinner.name : "";

  const actorUserId = normalizeId(args.ctx.adminUserId) || null;
  const nowIso = args.nowIso;
  const seeds: DemoMessageSeed[] = [
    {
      role: "customer",
      body: "Uploaded bracket STEP. Need quote + lead time.",
      senderName: "Demo Customer",
      createdAtIso: shiftIso(nowIso, -3 * 60 * 1000),
    },
    {
      role: "admin",
      body: "Got it — routing to 3 suppliers now.",
      senderName: "Admin",
      createdAtIso: shiftIso(nowIso, -2 * 60 * 1000),
    },
    ...(providerId
      ? ([
          {
            role: "supplier" as const,
            body: "We can hit 7–10 days. Any anodize requirement?",
            senderName: providerName || "Supplier",
            providerId,
            createdAtIso: shiftIso(nowIso, -1 * 60 * 1000),
          },
        ] as DemoMessageSeed[])
      : []),
  ];

  try {
    if (hasNewSchema) {
      const includeProviderId = await hasColumns("quote_messages", ["provider_id"]);
      const includeSenderName = await hasColumns("quote_messages", ["sender_name"]);
      const includeAuthorUserId = await hasColumns("quote_messages", ["author_user_id"]);

      const rows = seeds.map((m) => {
        const authorRole = m.role === "supplier" ? "provider" : m.role;
        const payload: Record<string, unknown> = {
          quote_id: quoteId,
          created_at: m.createdAtIso,
          author_role: authorRole,
          message: m.body,
        };
        if (includeAuthorUserId) {
          payload.author_user_id = actorUserId;
        }
        if (includeSenderName && m.senderName) {
          payload.sender_name = m.senderName;
        }
        if (includeProviderId && m.providerId) {
          payload.provider_id = m.providerId;
        }
        return payload;
      });

      const { error } = await args.admin.from("quote_messages").insert(rows);
      if (error) {
        if (!isMissingTableOrColumnError(error)) {
          console.warn("[demo seed] quote_messages insert failed; continuing", {
            quoteId,
            error: serializeSupabaseError(error) ?? error,
          });
        }
      }
      return;
    }

    if (hasLegacySchema) {
      const includeSenderName = await hasColumns("quote_messages", ["sender_name"]);
      const includeProviderId = await hasColumns("quote_messages", ["provider_id"]);
      const rows = seeds.map((m) => {
        const senderRole = m.role === "supplier" ? "supplier" : m.role;
        const payload: Record<string, unknown> = {
          quote_id: quoteId,
          created_at: m.createdAtIso,
          sender_role: senderRole,
          sender_id: actorUserId ?? quoteId,
          body: m.body,
        };
        if (includeSenderName && m.senderName) {
          payload.sender_name = m.senderName;
        }
        if (includeProviderId && m.providerId) {
          payload.provider_id = m.providerId;
        }
        return payload;
      });
      const { error } = await args.admin.from("quote_messages").insert(rows);
      if (error) {
        if (!isMissingTableOrColumnError(error)) {
          console.warn("[demo seed] quote_messages insert failed; continuing", {
            quoteId,
            error: serializeSupabaseError(error) ?? error,
          });
        }
      }
    }
  } catch (error) {
    if (!isMissingTableOrColumnError(error)) {
      console.warn("[demo seed] quote_messages insert crashed; continuing", {
        quoteId,
        error: serializeSupabaseError(error) ?? error,
      });
    }
  }
}

