import "@crm/env/load";

/**
 * Outbound email for the CRM, via Brevo's transactional API.
 *
 * Brevo rather than Resend: `support@webability.io` is already a verified Brevo
 * sender, so nothing has to change in DNS and mail arrives from the address
 * customers already correspond with. A new provider would mean a new SPF/DKIM
 * record on a domain that already sends live customer mail.
 *
 * What this deliberately does NOT do: reply into an existing Gmail thread.
 * Brevo has no visibility of a Gmail thread id, so a "reply" sent this way opens
 * a new conversation on the recipient's side and never appears in the sender's
 * Gmail sent folder. Use the `gog` CLI for replies to live threads; use this for
 * new outbound and for automation.
 */

const API = "https://api.brevo.com/v3/smtp/email";

export type EmailAttachment = {
  /** File name the recipient sees. */
  name: string;
  /** Base64-encoded content. */
  content: string;
};

export type SendEmailInput = {
  to: string[];
  cc?: string[];
  subject: string;
  /** Plain text. Newlines become <br> in the HTML part. */
  text: string;
  attachments?: EmailAttachment[];
  /** Defaults to support@webability.io — a verified Brevo sender. */
  from?: { email: string; name?: string };
  replyTo?: string;
  /** Tag for Brevo's own reporting. */
  tag?: string;
};

export type SendEmailResult = { messageId: string };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.BREVO_API_KEY);
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const key = process.env.BREVO_API_KEY;
  if (!key) throw new Error("BREVO_API_KEY is not set — refusing to send.");
  if (!input.to.length) throw new Error("An email needs at least one recipient.");

  const from = input.from ?? {
    email: process.env.EMAIL_FROM ?? "support@webability.io",
    name: process.env.EMAIL_FROM_NAME ?? "WebAbility",
  };

  const body = {
    sender: from,
    to: input.to.map((email) => ({ email })),
    ...(input.cc?.length ? { cc: input.cc.map((email) => ({ email })) } : {}),
    subject: input.subject,
    textContent: input.text,
    htmlContent: `<div style="font:14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a">${escapeHtml(input.text).replace(/\n/g, "<br>")}</div>`,
    ...(input.replyTo ? { replyTo: { email: input.replyTo } } : {}),
    ...(input.attachments?.length ? { attachment: input.attachments } : {}),
    ...(input.tag ? { tags: [input.tag] } : {}),
  };

  const res = await fetch(API, {
    method: "POST",
    headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Brevo rejected the send (${res.status}): ${detail.slice(0, 300)}`);
  }

  const json = (await res.json()) as { messageId?: string };
  return { messageId: json.messageId ?? "" };
}
