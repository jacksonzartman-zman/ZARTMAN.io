"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import {
  loadSupplierByPrimaryEmail,
  loadSupplierByUserId,
} from "@/server/suppliers/profile";
import { serializeActionError } from "@/lib/forms";
import { createSupplierInvite, resendSupplierInvite } from "@/server/suppliers/invites";

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function requireSupplierWorkspace() {
  const user = await requireUser({ redirectTo: "/supplier/settings/team" });

  let supplier = await loadSupplierByUserId(user.id);
  if (!supplier && user.email) {
    supplier = await loadSupplierByPrimaryEmail(user.email);
  }

  return { user, supplier };
}

export async function sendSupplierInviteAction(formData: FormData) {
  try {
    const { user, supplier } = await requireSupplierWorkspace();

    if (!supplier) {
      redirect("/supplier/settings/team?error=Complete%20supplier%20onboarding%20before%20inviting%20teammates.");
    }

    const email = getString(formData.get("email")).toLowerCase();

    const result = await createSupplierInvite({
      supplierId: supplier.id,
      invitedEmail: email,
      invitedByUserId: user.id,
      supplierCompanyName: supplier.company_name ?? null,
    });

    if (!result.ok) {
      redirect(`/supplier/settings/team?error=${encodeURIComponent(result.error)}`);
    }

    revalidatePath("/supplier/settings/team");
    revalidatePath("/supplier/settings");

    redirect(`/supplier/settings/team?sent=${encodeURIComponent(result.invite.email)}`);
  } catch (error) {
    console.error("[supplier invites] create failed", {
      error: serializeActionError(error),
    });
    redirect("/supplier/settings/team?error=We%20couldn%E2%80%99t%20send%20that%20invite.%20Please%20try%20again.");
  }
}

export async function resendSupplierInviteAction(formData: FormData) {
  try {
    const { supplier } = await requireSupplierWorkspace();

    if (!supplier) {
      redirect("/supplier/settings/team?error=Complete%20supplier%20onboarding%20before%20resending%20invites.");
    }

    const inviteId = getString(formData.get("inviteId"));

    const result = await resendSupplierInvite({
      supplierId: supplier.id,
      inviteId,
      supplierCompanyName: supplier.company_name ?? null,
    });

    if (!result.ok) {
      redirect(`/supplier/settings/team?error=${encodeURIComponent(result.error)}`);
    }

    revalidatePath("/supplier/settings/team");

    redirect(`/supplier/settings/team?resent=${encodeURIComponent(result.invite.email)}`);
  } catch (error) {
    console.error("[supplier invites] resend failed", {
      error: serializeActionError(error),
    });
    redirect("/supplier/settings/team?error=We%20couldn%E2%80%99t%20resend%20that%20invite.%20Please%20try%20again.");
  }
}
