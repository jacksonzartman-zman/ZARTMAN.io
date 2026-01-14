function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return null;
}

export function readEmailInboundEnabledEnv(): boolean | null {
  return normalizeBool(process.env.EMAIL_INBOUND_ENABLED);
}

export function readEmailOutboundEnabledEnv(): boolean | null {
  return normalizeBool(process.env.EMAIL_OUTBOUND_ENABLED);
}

export function readPortalEmailSendEnabledEnv(): boolean | null {
  return normalizeBool(process.env.PORTAL_EMAIL_SEND_ENABLED);
}

export function isEmailInboundEnabled(): boolean {
  const explicit = readEmailInboundEnabledEnv();
  if (explicit === true) return true;
  if (explicit === false) return false;

  // Default behavior: inbound remains OFF unless Postmark inbound basic auth is configured.
  // This keeps the "generic" inbound endpoint inert unless explicitly enabled.
  const hasBasicUser = Boolean(normalizeString(process.env.POSTMARK_INBOUND_BASIC_USER));
  const hasBasicPass = Boolean(normalizeString(process.env.POSTMARK_INBOUND_BASIC_PASS));
  return hasBasicUser && hasBasicPass;
}

export function isGenericInboundEnabled(): boolean {
  // Generic inbound has no provider auth surface; keep it explicit-only.
  return normalizeBool(process.env.EMAIL_INBOUND_ENABLED) === true;
}

export function isPostmarkInboundBasicAuthConfigured(): boolean {
  const hasBasicUser = Boolean(normalizeString(process.env.POSTMARK_INBOUND_BASIC_USER));
  const hasBasicPass = Boolean(normalizeString(process.env.POSTMARK_INBOUND_BASIC_PASS));
  return hasBasicUser && hasBasicPass;
}

export function isEmailOutboundEnabled(): boolean {
  return readEmailOutboundEnabledEnv() === true;
}

export function isPortalEmailSendEnabledFlag(): boolean {
  return readPortalEmailSendEnabledEnv() === true;
}

