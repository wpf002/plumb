import { refresh, type QboTokens } from "./oauth.js";

const PROD = "https://quickbooks.api.intuit.com";
const SANDBOX = "https://sandbox-quickbooks.api.intuit.com";

export interface QboClientOptions {
  realmId: string;
  tokens: QboTokens;
  environment?: "production" | "sandbox";
  /** Called when tokens are refreshed so the caller can persist them. */
  onTokenRefresh?: (tokens: QboTokens) => Promise<void> | void;
}

export class QboClient {
  private tokens: QboTokens;
  private readonly base: string;

  constructor(private opts: QboClientOptions) {
    this.tokens = opts.tokens;
    this.base = opts.environment === "sandbox" ? SANDBOX : PROD;
  }

  private async ensureFresh(): Promise<void> {
    if (this.tokens.expiresAt.getTime() > Date.now()) return;
    this.tokens = await refresh(this.tokens.refreshToken);
    await this.opts.onTokenRefresh?.(this.tokens);
  }

  /**
   * Run a QBO SQL-ish query and page through all results.
   * e.g. query<Invoice>("Invoice", "WHERE MetaData.LastUpdatedTime > '2026-01-01'")
   */
  async query<T = unknown>(entity: string, where = ""): Promise<T[]> {
    await this.ensureFresh();
    const out: T[] = [];
    let start = 1;
    const page = 500;
    for (;;) {
      const q = `SELECT * FROM ${entity} ${where} STARTPOSITION ${start} MAXRESULTS ${page}`;
      const url = `${this.base}/v3/company/${this.opts.realmId}/query?query=${encodeURIComponent(q)}&minorversion=73`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.tokens.accessToken}`,
          Accept: "application/json",
        },
      });
      if (!res.ok) {
        throw new Error(`QBO query ${entity} failed: ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as {
        QueryResponse?: Record<string, T[] | number>;
      };
      const rows = (body.QueryResponse?.[entity] as T[]) ?? [];
      out.push(...rows);
      if (rows.length < page) break;
      start += page;
    }
    return out;
  }

  get currentTokens(): QboTokens {
    return this.tokens;
  }
}
