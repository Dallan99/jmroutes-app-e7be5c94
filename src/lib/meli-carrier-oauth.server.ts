const SIX_HOURS_SECONDS = 6 * 60 * 60;
const DEFAULT_RENEWAL_WINDOW_MS = 10 * 60 * 1000;

export type MeliCarrierCachedToken = {
  audience: string;
  accessToken: string;
  expiresAt: string;
};

/** Persistência injetável. A implementação futura pode usar o cache criptografado no Supabase. */
export interface MeliCarrierTokenStore {
  get(audience: string): Promise<MeliCarrierCachedToken | null>;
  put(token: MeliCarrierCachedToken): Promise<void>;
}

export type MeliCarrierOAuthConfig = {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  renewalWindowMs?: number;
  fetchImpl?: typeof fetch;
};

type TokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
};

export function shouldRefreshMeliCarrierToken(
  token: MeliCarrierCachedToken | null,
  nowMs = Date.now(),
  renewalWindowMs = DEFAULT_RENEWAL_WINDOW_MS,
): boolean {
  if (!token) return true;
  const expiresAt = new Date(token.expiresAt).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= nowMs + renewalWindowMs;
}

function basicAuthorization(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
}

function expiresInSeconds(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : SIX_HOURS_SECONDS;
}

/**
 * Cliente OAuth server-to-server isolado. Ele só será executado quando um
 * adaptador oficial o chamar; o worker/AdminML atual não importa este módulo.
 */
export class MeliCarrierOAuthClient {
  constructor(
    private readonly config: MeliCarrierOAuthConfig,
    private readonly store: MeliCarrierTokenStore,
  ) {}

  async getAccessToken(audience: string): Promise<string> {
    const normalizedAudience = audience.trim();
    if (!normalizedAudience) throw new Error("MELI audience obrigatória.");

    const cached = await this.store.get(normalizedAudience);
    if (
      !shouldRefreshMeliCarrierToken(
        cached,
        Date.now(),
        this.config.renewalWindowMs ?? DEFAULT_RENEWAL_WINDOW_MS,
      )
    ) {
      return cached!.accessToken;
    }

    const response = await (this.config.fetchImpl ?? fetch)(this.config.tokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: basicAuthorization(this.config.clientId, this.config.clientSecret),
      },
      body: JSON.stringify({ grant_type: "client_credentials", audience: normalizedAudience }),
    });

    if (!response.ok) {
      throw new Error(`OAuth server-to-server Meli respondeu ${response.status}.`);
    }

    const body = (await response.json()) as TokenResponse;
    if (typeof body.access_token !== "string" || !body.access_token) {
      throw new Error("Resposta OAuth Meli sem access_token.");
    }

    const token: MeliCarrierCachedToken = {
      audience: normalizedAudience,
      accessToken: body.access_token,
      expiresAt: new Date(Date.now() + expiresInSeconds(body.expires_in) * 1000).toISOString(),
    };
    await this.store.put(token);
    return token.accessToken;
  }
}

/** Lê segredos apenas no servidor e nunca fornece valor padrão para credenciais. */
export function meliCarrierOAuthConfigFromEnv(tokenUrl: string): MeliCarrierOAuthConfig {
  const clientId = process.env["MELI_CLIENT_ID"];
  const clientSecret = process.env["MELI_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    throw new Error("MELI_CLIENT_ID e MELI_CLIENT_SECRET devem estar configurados no servidor.");
  }
  return { clientId, clientSecret, tokenUrl };
}

