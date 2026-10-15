// Plaid bank-feed client for opening cash. Live when PLAID_CLIENT_ID +
// PLAID_SECRET are set; otherwise a dry-run that simulates a connected bank so
// the onboarding flow works end-to-end without credentials. The dry-run never
// touches the network.

const PLAID_HOSTS: Record<string, string> = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
};

export interface PlaidClient {
  readonly live: boolean;
  createLinkToken(userId: string): Promise<{ linkToken: string }>;
  exchangePublicToken(publicToken: string): Promise<{ accessToken: string }>;
  /** Total available cash across depository accounts, in integer cents. */
  getBalanceCents(accessToken: string): Promise<number>;
}

class LivePlaid implements PlaidClient {
  readonly live = true;
  constructor(
    private clientId: string,
    private secret: string,
    private host: string
  ) {}

  private async call<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.host}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: this.clientId, secret: this.secret, ...body }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Plaid ${path} failed (${res.status}): ${text}`);
    }
    return (await res.json()) as T;
  }

  async createLinkToken(userId: string) {
    const r = await this.call<{ link_token: string }>("/link/token/create", {
      user: { client_user_id: userId },
      client_name: "DNRD",
      // Transactions with the full 24 months of history, for recurring detection.
      products: ["transactions"],
      transactions: { days_requested: 730 },
      country_codes: ["US"],
      language: "en",
    });
    return { linkToken: r.link_token };
  }

  async exchangePublicToken(publicToken: string) {
    const r = await this.call<{ access_token: string }>("/item/public_token/exchange", {
      public_token: publicToken,
    });
    return { accessToken: r.access_token };
  }

  async getBalanceCents(accessToken: string) {
    const r = await this.call<{
      accounts: { type: string; balances: { available: number | null; current: number | null } }[];
    }>("/accounts/balance/get", { access_token: accessToken });
    const dollars = r.accounts
      .filter((a) => a.type === "depository")
      .reduce((sum, a) => sum + (a.balances.available ?? a.balances.current ?? 0), 0);
    return Math.round(dollars * 100);
  }
}

class DryRunPlaid implements PlaidClient {
  readonly live = false;
  async createLinkToken() {
    return { linkToken: "link-sandbox-dry-run" };
  }
  async exchangePublicToken() {
    return { accessToken: "access-sandbox-dry-run" };
  }
  async getBalanceCents() {
    // A believable owner-operator bank balance for the demo.
    return 312_450_00;
  }
}

export function getPlaid(): PlaidClient {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const env = process.env.PLAID_ENV ?? "sandbox";
  if (clientId && secret) {
    return new LivePlaid(clientId, secret, PLAID_HOSTS[env] ?? PLAID_HOSTS.sandbox);
  }
  return new DryRunPlaid();
}
