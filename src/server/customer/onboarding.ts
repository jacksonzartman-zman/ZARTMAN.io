import { supabaseServer } from "@/lib/supabaseServer";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import { getCustomerByEmail, getCustomerByUserId } from "@/server/customers";
import { serializeSupabaseError } from "@/server/admin/logging";

export type CustomerOnboardingState = {
  hasAnyQuotes: boolean;
  hasAnyProjects: boolean;
};

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function loadCustomerOnboardingState(userIdOrEmail: {
  userId: string | null;
  email: string | null;
}): Promise<CustomerOnboardingState> {
  const userId = normalizeId(userIdOrEmail?.userId);
  const email = normalizeEmailInput(userIdOrEmail?.email ?? null);

  const customer = userId ? await getCustomerByUserId(userId) : null;
  const customerFallback = !customer && email ? await getCustomerByEmail(email) : null;
  const customerEmail = normalizeEmailInput(customer?.email ?? customerFallback?.email ?? email);
  const customerId = normalizeId(customer?.id ?? customerFallback?.id);

  if (!customerEmail) {
    return { hasAnyQuotes: false, hasAnyProjects: false };
  }

  let hasAnyQuotes = false;
  let hasAnyProjects = false;

  try {
    const { data, error } = await supabaseServer
      .from("quotes_with_uploads")
      .select("id")
      .ilike("customer_email", customerEmail)
      .limit(1);

    if (error) {
      console.error("[customer onboarding] quote existence query failed", {
        userId: userId || null,
        customerId: customerId || null,
        email: customerEmail,
        error: serializeSupabaseError(error) ?? error,
      });
    } else {
      hasAnyQuotes = Array.isArray(data) && data.length > 0;
    }
  } catch (error) {
    console.error("[customer onboarding] quote existence query crashed", {
      userId: userId || null,
      customerId: customerId || null,
      email: customerEmail,
      error: serializeSupabaseError(error) ?? error,
    });
  }

  if (customerId) {
    try {
      // Mirror the customer projects loader award rules.
      const { data, error } = await supabaseServer
        .from("quotes")
        .select("id")
        .eq("customer_id", customerId)
        .in("status", ["won", "win"])
        .not("awarded_supplier_id", "is", null)
        .not("awarded_at", "is", null)
        .limit(1);

      if (error) {
        console.error("[customer onboarding] project existence query failed", {
          userId: userId || null,
          customerId,
          error: serializeSupabaseError(error) ?? error,
        });
      } else {
        hasAnyProjects = Array.isArray(data) && data.length > 0;
      }
    } catch (error) {
      console.error("[customer onboarding] project existence query crashed", {
        userId: userId || null,
        customerId,
        error: serializeSupabaseError(error) ?? error,
      });
    }
  }

  return { hasAnyQuotes, hasAnyProjects };
}
