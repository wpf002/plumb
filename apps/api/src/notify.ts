import type { DigestResult, DigestSeverity } from "@plumb/engine";

// Plain-text markers (email has no color); the HTML version uses colored dots.
const MARK: Record<DigestSeverity, string> = {
  critical: "[!]",
  warning: "[.]",
  good: "[ok]",
};

const SEV_COLOR: Record<DigestSeverity, string> = {
  critical: "#b42318",
  warning: "#b45309",
  good: "#157a5a",
};

export function renderDigestText(d: DigestResult): string {
  const lines = [
    `Plumb Weekly — ${d.companyName}`,
    `Week of ${d.asOf} · Business Health ${d.score}/100`,
    "",
    d.headline,
    "",
  ];
  for (const item of d.items) {
    lines.push(`${MARK[item.severity]} ${item.title}`);
    if (item.detail && item.detail !== item.title) lines.push(`    ${item.detail}`);
  }
  lines.push("", "Plumb. Reply if a number looks off.");
  return lines.join("\n");
}

export function renderDigestHtml(d: DigestResult): string {
  const dot = (sev: DigestSeverity) =>
    `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${SEV_COLOR[sev]}"></span>`;
  const rows = d.items
    .map(
      (i) => `
      <tr>
        <td style="vertical-align:top;padding:11px 10px 11px 0">${dot(i.severity)}</td>
        <td style="padding:9px 0;border-bottom:1px solid #eee">
          <div style="font-weight:600;color:${SEV_COLOR[i.severity]}">${escape(i.title)}</div>
          ${i.detail && i.detail !== i.title ? `<div style="color:#555;font-size:14px;margin-top:2px">${escape(i.detail)}</div>` : ""}
        </td>
      </tr>`
    )
    .join("");
  return `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#111">
    <p style="color:#888;margin:0">Plumb Weekly — ${escape(d.companyName)}</p>
    <h1 style="font-size:20px;margin:4px 0">Business Health ${d.score}/100</h1>
    <p style="font-size:16px;font-weight:600;margin:12px 0 16px">${escape(d.headline)}</p>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    <p style="color:#999;font-size:12px;margin-top:20px">Week of ${d.asOf}. Reply if a number looks off.</p>
  </div>`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface SendResult {
  delivered: boolean;
  provider: string;
  to: string;
  detail: string;
}

export interface Notifier {
  send(msg: { to: string; subject: string; text: string; html: string }): Promise<SendResult>;
}

/** Default notifier: renders and logs, never sends. Safe without credentials. */
export class DryRunNotifier implements Notifier {
  async send(msg: { to: string; subject: string; text: string; html: string }): Promise<SendResult> {
    return {
      delivered: false,
      provider: "dry-run",
      to: msg.to,
      detail: "No email provider configured (set RESEND_API_KEY + DIGEST_FROM to send for real).",
    };
  }
}

/** Live email via Resend's HTTP API. Only selected when RESEND_API_KEY is set. */
export class ResendNotifier implements Notifier {
  constructor(private apiKey: string, private from: string) {}

  async send(msg: { to: string; subject: string; text: string; html: string }): Promise<SendResult> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend send failed (${res.status}): ${body}`);
    }
    const json = (await res.json()) as { id?: string };
    return {
      delivered: true,
      provider: "resend",
      to: msg.to,
      detail: `Sent (id ${json.id ?? "unknown"}).`,
    };
  }
}

/** Pick a notifier from the environment. Dry-run unless Resend is configured. */
export function getNotifier(): Notifier {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.DIGEST_FROM;
  if (key && from) return new ResendNotifier(key, from);
  return new DryRunNotifier();
}
