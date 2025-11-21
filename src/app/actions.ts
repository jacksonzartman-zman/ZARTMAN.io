"use server";

export type EarlyAccessFormState = {
  success?: boolean;
  error?: string;
  message?: string;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function requestEarlyAccess(
  _prevState: EarlyAccessFormState,
  formData: FormData,
): Promise<EarlyAccessFormState> {
  const emailValue = formData.get("email");
  const email = typeof emailValue === "string" ? emailValue.trim() : "";

  if (!email) {
    return { error: "Email is required." };
  }

  if (!EMAIL_REGEX.test(email)) {
    return { error: "Enter a valid email address." };
  }

  console.log(`[early-access] request received from ${email}`);

  return {
    success: true,
    message: "Thanks! We’ll reach out soon.",
  };
}
