// Intuit OAuth2. Docs: https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization
const AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL =
  "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const SCOPE = "com.intuit.quickbooks.accounting";

export interface QboOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface QboTokens {
  accessToken: string;
  refreshToken: string;
  /** Absolute expiry of the access token. */
  expiresAt: Date;
}

function cfg(): QboOAuthConfig {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const redirectUri = process.env.QBO_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri)
    throw new Error("QBO_CLIENT_ID / QBO_CLIENT_SECRET / QBO_REDIRECT_URI not set");
  return { clientId, clientSecret, redirectUri };
}

/** Step 1: URL to send the owner to. `state` should be a signed companyId nonce. */
export function authorizeUrl(state: string): string {
  const { clientId, redirectUri } = cfg();
  const p = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: SCOPE,
    redirect_uri: redirectUri,
    state,
  });
  return `${AUTH_URL}?${p.toString()}`;
}

async function tokenRequest(body: URLSearchParams): Promise<QboTokens> {
  const { clientId, clientSecret } = cfg();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`QBO token request failed: ${res.status} ${await res.text()}`);
  }
  const j = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    // subtract 60s of slack so we refresh before hard expiry
    expiresAt: new Date(Date.now() + (j.expires_in - 60) * 1000),
  };
}

/** Step 2: exchange the callback `code` for tokens. Also returns realmId. */
export async function exchangeCode(
  code: string
): Promise<QboTokens> {
  const { redirectUri } = cfg();
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    })
  );
}

/** Refresh an access token before it expires. */
export async function refresh(refreshToken: string): Promise<QboTokens> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    })
  );
}
