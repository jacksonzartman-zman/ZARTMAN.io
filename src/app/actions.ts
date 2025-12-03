"use server";

import {
  CONTACT_FOCUS_VALUES,
  type ContactFocusValue,
} from "@/data/contact";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ContactFieldErrors = Partial<
  Record<"name" | "email" | "company" | "role" | "message", string>
>;

export type ContactFormState = {
  success?: boolean;
  error?: string | null;
  message?: string | null;
  fieldErrors?: ContactFieldErrors;
};

export async function submitContactRequest(
  _prevState: ContactFormState,
  formData: FormData,
): Promise<ContactFormState> {
  const nameValue = formData.get("name");
  const emailValue = formData.get("email");
  const companyValue = formData.get("company");
  const roleValue = formData.get("role");
  const messageValue = formData.get("message");
  const focusValue = formData.get("focus");

  const name = typeof nameValue === "string" ? nameValue.trim() : "";
  const email = typeof emailValue === "string" ? emailValue.trim() : "";
  const company = typeof companyValue === "string" ? companyValue.trim() : "";
  const role = typeof roleValue === "string" ? roleValue.trim() : "";
  const message = typeof messageValue === "string" ? messageValue.trim() : "";
  const focusRaw = typeof focusValue === "string" ? focusValue : "";
  const focus = CONTACT_FOCUS_VALUES.includes(focusRaw as ContactFocusValue)
    ? (focusRaw as ContactFocusValue)
    : null;

  const fieldErrors: ContactFieldErrors = {};

  if (!name) {
    fieldErrors.name = "Name is required.";
  }

  if (!email) {
    fieldErrors.email = "Work email is required.";
  } else if (!EMAIL_REGEX.test(email)) {
    fieldErrors.email = "Enter a valid email.";
  }

  if (!company) {
    fieldErrors.company = "Company is required.";
  }

  if (!message) {
    fieldErrors.message = "Let us know what you need.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      success: false,
      error: "Please fix the highlighted fields and try again.",
      fieldErrors,
    };
  }

  console.log("[contact] request", {
    name,
    email,
    company,
    role,
    focus,
    message,
  });

  return {
    success: true,
    message: "We've got your note. Jackson will reach out within a business day.",
    fieldErrors: {},
  };
}
