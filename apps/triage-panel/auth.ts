export interface OAuthConfig {
  domain: string;
  clientId: string;
  redirectUri: string;
}
const transactionKey = "brvital.oauth";
const tokenKey = "brvital.staffToken";
function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function domainUrl(config: OAuthConfig) {
  const url = new URL(config.domain);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Configure um domínio Cognito HTTPS válido.");
  return url.origin;
}
export function configuredOAuth(): OAuthConfig | null {
  const {
    VITE_COGNITO_DOMAIN: domain,
    VITE_COGNITO_CLIENT_ID: clientId,
    VITE_COGNITO_REDIRECT_URI: redirectUri,
  } = import.meta.env;
  return domain && clientId && redirectUri
    ? { domain, clientId, redirectUri }
    : null;
}
export async function beginLogin(
  config: OAuthConfig,
  navigate = (url: string) => window.location.assign(url),
) {
  const origin = domainUrl(config);
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(24)));
  const challenge = base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  sessionStorage.setItem(
    transactionKey,
    JSON.stringify({ verifier, state, createdAt: Date.now() }),
  );
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    scope: "openid",
    redirect_uri: config.redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  navigate(`${origin}/oauth2/authorize?${params}`);
}
export async function completeLogin(
  config: OAuthConfig,
  search = window.location.search,
): Promise<string | null> {
  const params = new URLSearchParams(search);
  if (!params.has("code") && !params.has("error")) return null;
  const raw = sessionStorage.getItem(transactionKey);
  sessionStorage.removeItem(transactionKey);
  if (params.has("error"))
    throw new Error("Acesso não autorizado pelo provedor. Entre novamente.");
  const transaction = raw
    ? (JSON.parse(raw) as {
        verifier: string;
        state: string;
        createdAt: number;
      })
    : null;
  if (
    !transaction ||
    transaction.state !== params.get("state") ||
    Date.now() - transaction.createdAt > 600_000
  )
    throw new Error("Sessão de acesso inválida ou expirada. Entre novamente.");
  const response = await fetch(`${domainUrl(config)}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      code: params.get("code")!,
      code_verifier: transaction.verifier,
    }),
  });
  if (!response.ok)
    throw new Error(
      "Não foi possível confirmar o acesso no Cognito. Entre novamente.",
    );
  const result = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!result.access_token)
    throw new Error("O provedor não retornou uma credencial de acesso.");
  saveToken(result.access_token, result.expires_in ?? 3600);
  return result.access_token;
}
export function saveToken(token: string, expiresIn = 3600) {
  sessionStorage.setItem(
    tokenKey,
    JSON.stringify({ token, expiresAt: Date.now() + expiresIn * 1000 }),
  );
}
export function restoreToken() {
  try {
    const raw = sessionStorage.getItem(tokenKey);
    if (!raw) return null;
    const result = JSON.parse(raw) as { token: string; expiresAt: number };
    if (result.expiresAt > Date.now()) return result.token;
  } catch {
    /* Uma sessão inválida exige novo acesso. */
  }
  clearToken();
  return null;
}
export function clearToken() {
  sessionStorage.removeItem(tokenKey);
  sessionStorage.removeItem(transactionKey);
}
