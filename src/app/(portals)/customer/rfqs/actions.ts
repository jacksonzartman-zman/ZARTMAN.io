"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import {
  createRfqForCustomer,
  type CreateRfqFileInput,
} from "@/server/marketplace/rfqs";

export type CreateCustomerRfqActionState = {
  error: string | null;
  success: boolean;
};

export const INITIAL_CUSTOMER_RFQ_STATE: CreateCustomerRfqActionState = {
  error: null,
  success: false,
};

const GENERIC_ERROR = "Unable to create the RFQ right now. Please try again.";

export async function createCustomerRfqAction(
  _prev: CreateCustomerRfqActionState,
  formData: FormData,
): Promise<CreateCustomerRfqActionState> {
  try {
    const session = await requireSession({ redirectTo: "/customer/rfqs" });
    const customer = await getCustomerByUserId(session.user.id);

    if (!customer) {
      return {
        error: "Complete your customer profile before posting RFQs.",
        success: false,
      };
    }

    const title = getText(formData, "title");
    const description = getText(formData, "description");
    const targetProcesses = getCsv(formData, "target_processes");
    const budgetAmount = getNumber(formData, "budget_amount");
    const budgetCurrency = getText(formData, "budget_currency");
    const leadTimeDays = getNumber(formData, "lead_time_days");
    const fileLabel = getText(formData, "file_label");

    if (!title || !description) {
      return {
        error: "Add a title and project description to submit an RFQ.",
        success: false,
      };
    }

    const files: CreateRfqFileInput[] =
      fileLabel && fileLabel.length > 0
        ? [
            {
              storageKey: `placeholder:${randomUUID()}`,
              fileName: fileLabel,
              fileType: "other",
            },
          ]
        : [];

    const result = await createRfqForCustomer(customer.id, {
      title,
      description,
      targetProcesses,
      budgetAmount,
      budgetCurrency,
      leadTimeDays,
      files,
    });

    if (result.error || !result.rfq) {
      return {
        error: result.error ?? GENERIC_ERROR,
        success: false,
      };
    }

    revalidatePath("/customer/rfqs");
    return { error: null, success: true };
  } catch (error) {
    console.error("createCustomerRfqAction: unexpected error", error);
    return { error: GENERIC_ERROR, success: false };
  }
}

function getText(formData: FormData, key: string): string | null {
  const raw = formData.get(key);
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getNumber(formData: FormData, key: string): number | null {
  const raw = getText(formData, key);
  if (!raw) {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function getCsv(formData: FormData, key: string): string[] {
  const raw = getText(formData, key);
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}
