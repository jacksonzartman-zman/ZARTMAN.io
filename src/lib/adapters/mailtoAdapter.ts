type MailtoArgs = {
  to: string | string[];
  subject?: string | null;
  body?: string | null;
};

function normalizeRecipients(value: MailtoArgs["to"]): string {
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).filter(Boolean).join(",");
  }
  return value.trim();
}

function normalizeBody(value: string): string {
  return value.replace(/\r?\n/g, "\r\n");
}

export function buildMailtoUrl({ to, subject, body }: MailtoArgs): string {
  const recipients = normalizeRecipients(to);
  const params = new URLSearchParams();
  const normalizedSubject = typeof subject === "string" ? subject.trim() : "";
  if (normalizedSubject) {
    params.set("subject", normalizedSubject);
  }
  const normalizedBody = typeof body === "string" ? normalizeBody(body.trim()) : "";
  if (normalizedBody) {
    params.set("body", normalizedBody);
  }
  const query = params.toString();
  return query ? `mailto:${recipients}?${query}` : `mailto:${recipients}`;
}
