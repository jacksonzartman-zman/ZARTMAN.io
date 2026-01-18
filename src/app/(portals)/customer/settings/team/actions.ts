"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCustomerSessionOrRedirect } from "@/app/(portals)/customer/requireCustomerSessionOrRedirect";
import { getCustomerByUserId } from "@/server/customers";
import { serializeActionError } from "@/lib/forms";
import { createCustomerInvite, resendCustomerInvite } from "@/server/customers/invites";

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function requireCustomerWorkspace() {
  const user = await requireCustomerSessionOrRedirect("/customer/settings/team");
  const customer = await getCustomerByUserId(user.id);
  return { user, customer };
}

export async function sendCustomerInviteAction(formData: FormData) {
  try {
    const { user, customer } = await requireCustomerWorkspace();

    if (!customer) {
      redirect("/customer/settings/team?error=Complete%20your%20customer%20profile%20before%20inviting%20teammates.");
    }

    const email = getString(formData.get("email")).toLowerCase();

    const result = await createCustomerInvite({
      customerId: customer.id,
      invitedEmail: email,
      invitedByUserId: user.id,
      customerCompanyName: customer.company_name ?? null,
    });

    if (!result.ok) {
      redirect(`/customer/settings/team?error=${encodeURIComponent(result.error)}`);
    }

    revalidatePath("/customer/settings/team");
    revalidatePath("/customer/settings");

    redirect(`/customer/settings/team?sent=${encodeURIComponent(result.invite.email)}`);
  } catch (error) {
    console.error("[customer invites] create failed", {
      error: serializeActionError(error),
    });
    redirect("/customer/settings/team?error=We%20couldn%E2%80%99t%20send%20that%20invite.%20Please%20try%20again.");
  }
}

export async function resendCustomerInviteAction(formData: FormData) {
  try {
    const { customer } = await requireCustomerWorkspace();

    if (!customer) {
      redirect("/customer/settings/team?error=Complete%20your%20customer%20profile%20before%20resending%20invites.");
    }

    const inviteId = getString(formData.get("inviteId"));

    const result = await resendCustomerInvite({
      customerId: customer.id,
      inviteId,
      customerCompanyName: customer.company_name ?? null,
    });

    if (!result.ok) {
      redirect(`/customer/settings/team?error=${encodeURIComponent(result.error)}`);
    }

    revalidatePath("/customer/settings/team");

    redirect(`/customer/settings/team?resent=${encodeURIComponent(result.invite.email)}`);
  } catch (error) {
    console.error("[customer invites] create failed", {
      error: serializeActionError(error),
    });
    redirect("/customer/settings/team?error=We%20couldn%E2%80%99t%20resend%20that%20invite.%20Please%20try%20again.");
  }
}

