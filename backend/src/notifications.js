import nodemailer from "nodemailer";

// Both channels are independently opt-in via env vars, same pattern as the
// Google/Entra SSO providers elsewhere in this app: unset means silently
// disabled rather than a startup failure, so a fresh clone still runs with
// zero config. Each send function resolves {sent: boolean, reason?: string}
// rather than throwing, so a flaky mail server or Slack outage never takes
// down the request that triggered the notification.

const SMTP_HOST = process.env.HELIX_SMTP_HOST || "";
const SMTP_PORT = Number(process.env.HELIX_SMTP_PORT || 587);
const SMTP_USER = process.env.HELIX_SMTP_USER || "";
const SMTP_PASS = process.env.HELIX_SMTP_PASS || "";
const SMTP_FROM = process.env.HELIX_SMTP_FROM || "Helix Remote <noreply@helix.local>";
const SLACK_WEBHOOK_URL = process.env.HELIX_SLACK_WEBHOOK_URL || "";

export function emailConfigured() {
  return Boolean(SMTP_HOST);
}

export function slackConfigured() {
  return Boolean(SLACK_WEBHOOK_URL);
}

let transporter = null;
function getTransporter() {
  if (!emailConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
    });
  }
  return transporter;
}

export async function sendEmail({ to, subject, text }) {
  if (!to) return { sent: false, reason: "No recipient email on file" };
  const t = getTransporter();
  if (!t) return { sent: false, reason: "Email is not configured (HELIX_SMTP_HOST unset)" };
  try {
    await t.sendMail({ from: SMTP_FROM, to, subject, text });
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

export async function sendSlack(text) {
  if (!slackConfigured()) return { sent: false, reason: "Slack is not configured (HELIX_SLACK_WEBHOOK_URL unset)" };
  try {
    const res = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text })
    });
    if (!res.ok) return { sent: false, reason: `Slack webhook responded ${res.status}` };
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

// Fire-and-forget helper for call sites that want to notify both channels
// without awaiting delivery or handling per-channel errors themselves —
// failures are logged, never thrown, so a notification can never break the
// action that triggered it (approving a grant, say).
export function notify({ email, slack } = {}) {
  if (email) {
    sendEmail(email)
      .then((r) => {
        if (!r.sent) console.log(`[helix] email notification skipped: ${r.reason}`);
      })
      .catch((err) => console.error("[helix] email notification failed:", err.message));
  }
  if (slack) {
    sendSlack(slack)
      .then((r) => {
        if (!r.sent) console.log(`[helix] Slack notification skipped: ${r.reason}`);
      })
      .catch((err) => console.error("[helix] Slack notification failed:", err.message));
  }
}
