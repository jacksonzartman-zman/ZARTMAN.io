import { supabaseServer } from "@/lib/supabaseServer";

export type CustomerRow = {
  id: string;
  user_id: string | null;
  email: string;
  company_name: string | null;
  phone: string | null;
  website: string | null;
  created_at: string;
  updated_at: string;
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
      .select("*")
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

type UpsertCustomerInput = {
  userId: string;
  email: string | null;
  companyName: string;
  phone?: string | null;
  website?: string | null;
};

export async function upsertCustomerProfileForUser(
  input: UpsertCustomerInput,
): Promise<CustomerRow | null> {
  const normalizedEmail = normalizeEmail(input.email);
  if (!normalizedEmail) {
    throw new Error("A valid email address is required.");
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
      return await updateCustomer(existingByUser.id, {
        company_name: companyName,
        phone,
        website,
      });
    }

    if (existingByEmail) {
      return await updateCustomer(existingByEmail.id, {
        user_id: input.userId,
        company_name: companyName,
        phone,
        website,
      });
    }

    const { data, error } = await supabaseServer
      .from("customers")
      .insert({
        user_id: input.userId,
        email: normalizedEmail,
        company_name: companyName,
        phone,
        website,
      })
      .select("*")
      .single<CustomerRow>();

    if (error) {
      console.error("upsertCustomerProfileForUser: insert failed", {
        userId: input.userId,
        email: normalizedEmail,
        error,
      });
      return null;
    }

    return data ?? null;
  } catch (error) {
    console.error("upsertCustomerProfileForUser: unexpected error", {
      userId: input.userId,
      email: normalizedEmail,
      error,
    });
    return null;
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
      .select("*")
      .eq("email", normalized)
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
    .select("*")
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
