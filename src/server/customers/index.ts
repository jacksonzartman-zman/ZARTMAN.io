import type { PostgrestError } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabaseServer";

const CUSTOMER_SELECT_COLUMNS =
  "id,user_id,email,company_name,phone,website,created_at,updated_at,notify_quote_messages,notify_quote_winner";

export type CustomerRow = {
  id: string;
  user_id: string | null;
  email: string;
  company_name: string | null;
  phone: string | null;
  website: string | null;
  created_at: string;
  updated_at: string;
  notify_quote_messages: boolean | null;
  notify_quote_winner: boolean | null;
};

export type CustomerProfileSaveOperation =
  | "updated_user"
  | "linked_email"
  | "inserted";

export type UpsertCustomerProfileResult =
  | {
      ok: true;
      customer: CustomerRow;
      operation: CustomerProfileSaveOperation;
    }
  | {
      ok: false;
      error: string;
      details?: unknown;
    };

function normalizeEmail(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeText(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function getCustomerByUserId(
  userId: string,
): Promise<CustomerRow | null> {
  if (!userId) {
    return null;
  }

  try {
    const { data, error } = await supabaseServer
      .from("customers")
      .select(CUSTOMER_SELECT_COLUMNS)
      .eq("user_id", userId)
      .maybeSingle<CustomerRow>();

    if (error) {
      console.error("getCustomerByUserId: lookup failed", {
        userId,
        error,
      });
      return null;
    }

    return data ?? null;
  } catch (error) {
    console.error("getCustomerByUserId: unexpected error", { userId, error });
    return null;
  }
}

export async function getCustomerById(
  customerId: string,
): Promise<CustomerRow | null> {
  if (!customerId) {
    return null;
  }

  try {
    const { data, error } = await supabaseServer
      .from("customers")
      .select(CUSTOMER_SELECT_COLUMNS)
      .eq("id", customerId)
      .maybeSingle<CustomerRow>();

    if (error) {
      console.error("getCustomerById: lookup failed", {
        customerId,
        error,
      });
      return null;
    }

    return data ?? null;
  } catch (error) {
    console.error("getCustomerById: unexpected error", {
      customerId,
      error,
    });
    return null;
  }
}

type UpsertCustomerInput = {
  userId: string;
  email: string | null;
  companyName: string;
  phone?: string | null;
  website?: string | null;
};

export async function upsertCustomerProfileForUser(
  input: UpsertCustomerInput,
): Promise<UpsertCustomerProfileResult> {
  const normalizedEmail = normalizeEmail(input.email);
  if (!normalizedEmail) {
    return {
      ok: false,
      error: "Your session is missing a valid email address.",
      details: { reason: "missing-email" },
    };
  }

  const companyName =
    sanitizeText(input.companyName) ??
    normalizedEmail.split("@")[0]?.replace(/\W+/g, " ").trim() ??
    "Customer";
  const phone = sanitizeText(input.phone);
  const website = sanitizeText(input.website);

  try {
    const existingByUser = await getCustomerByUserId(input.userId);
    const existingByEmail = await getCustomerByEmail(normalizedEmail);

    if (existingByUser) {
      const updated = await updateCustomer(existingByUser.id, {
        company_name: companyName,
        phone,
        website,
      });
      if (!updated) {
        return {
          ok: false,
          error: "We couldn’t update your existing profile record.",
          details: {
            reason: "update-existing-user",
            customerId: existingByUser.id,
          },
        };
      }
      return { ok: true, customer: updated, operation: "updated_user" };
    }

    if (existingByEmail) {
      const updated = await updateCustomer(existingByEmail.id, {
        user_id: input.userId,
        company_name: companyName,
        phone,
        website,
      });
      if (!updated) {
        return {
          ok: false,
          error: "We couldn’t link your profile to this account.",
          details: {
            reason: "update-existing-email",
            customerId: existingByEmail.id,
          },
        };
      }
      return { ok: true, customer: updated, operation: "linked_email" };
    }

    const insertPayload = {
      user_id: input.userId,
      email: normalizedEmail,
      company_name: companyName,
      phone,
      website,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseServer
      .from("customers")
      .insert(insertPayload)
      .select(CUSTOMER_SELECT_COLUMNS)
      .single<CustomerRow>();

    if (error || !data) {
      if (isUniqueConstraintError(error)) {
        const conflicting = await getCustomerByEmail(normalizedEmail);
        if (conflicting) {
          const updated = await updateCustomer(conflicting.id, {
            user_id: input.userId,
            company_name: companyName,
            phone,
            website,
          });
          if (updated) {
            return { ok: true, customer: updated, operation: "linked_email" };
          }
        }
      }

      console.error("upsertCustomerProfileForUser: insert failed", {
        userId: input.userId,
        email: normalizedEmail,
        payload: insertPayload,
        error,
      });
      return {
        ok: false,
        error: "We couldn’t create your customer profile right now.",
        details: error,
      };
    }

    return { ok: true, customer: data, operation: "inserted" };
  } catch (error) {
    console.error("upsertCustomerProfileForUser: unexpected error", {
      userId: input.userId,
      email: normalizedEmail,
      error,
    });
    return {
      ok: false,
      error: "Unexpected error while saving your customer profile.",
      details: error,
    };
  }
}

export async function getCustomerByEmail(email?: string | null) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return null;
  }

  try {
    const { data, error } = await supabaseServer
      .from("customers")
      .select(CUSTOMER_SELECT_COLUMNS)
      .ilike("email", normalized)
      .maybeSingle<CustomerRow>();

    if (error) {
      console.error("getCustomerByEmail: lookup failed", {
        email: normalized,
        error,
      });
      return null;
    }

    return data ?? null;
  } catch (error) {
    console.error("getCustomerByEmail: unexpected error", {
      email: normalized,
      error,
    });
    return null;
  }
}

export async function attachQuotesToCustomer(
  customerId: string,
  email?: string | null,
) {
  const normalizedEmail = normalizeEmail(email);
  if (!customerId || !normalizedEmail) {
    return;
  }

  try {
    const { error } = await supabaseServer
      .from("quotes")
      .update({
        customer_id: customerId,
        updated_at: new Date().toISOString(),
      })
      .is("customer_id", null)
      .ilike("email", normalizedEmail);

    if (error) {
      console.error("attachQuotesToCustomer: update failed", {
        customerId,
        email: normalizedEmail,
        error,
      });
    }
  } catch (error) {
    console.error("attachQuotesToCustomer: unexpected error", {
      customerId,
      email: normalizedEmail,
      error,
    });
  }
}

async function updateCustomer(
  customerId: string,
  changes: Partial<CustomerRow>,
) {
  const { data, error } = await supabaseServer
    .from("customers")
    .update({
      ...changes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", customerId)
      .select(CUSTOMER_SELECT_COLUMNS)
    .maybeSingle<CustomerRow>();

  if (error) {
    console.error("updateCustomer: update failed", {
      customerId,
      changes,
      error,
    });
    return null;
  }

  return data ?? null;
}

function isUniqueConstraintError(error?: PostgrestError | null): boolean {
  return Boolean(error?.code && error.code === "23505");
}

type UpsertCustomerByEmailInput = {
  email: string;
  companyName: string;
  phone?: string | null;
};

export async function upsertCustomerByEmail(
  input: UpsertCustomerByEmailInput,
): Promise<CustomerRow | null> {
  const normalizedEmail = normalizeEmail(input.email);
  if (!normalizedEmail) {
    throw new Error("A valid email address is required.");
  }

  const companyName =
    sanitizeText(input.companyName) ||
    normalizedEmail.split("@")[0]?.replace(/\W+/g, " ").trim() ||
    "Customer";
  const phone = sanitizeText(input.phone);

  const payload = {
    email: normalizedEmail,
    company_name: companyName,
    phone,
    updated_at: new Date().toISOString(),
  };

  try {
    const { data, error } = await supabaseServer
      .from("customers")
      .upsert(payload, { onConflict: "email" })
      .select(CUSTOMER_SELECT_COLUMNS)
      .single<CustomerRow>();

    if (error) {
      console.error("upsertCustomerByEmail: upsert failed", {
        email: normalizedEmail,
        payload,
        error,
      });
      return null;
    }

    return data ?? null;
  } catch (error) {
    console.error("upsertCustomerByEmail: unexpected error", {
      email: normalizedEmail,
      error,
    });
    return null;
  }
}
