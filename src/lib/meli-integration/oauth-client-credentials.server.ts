// ─────────────────────────────────────────────────────────────────────────────
// OAuth client_credentials (P0 — implementação isolada, sem consumidor).
//
// NÃO substitui nem toca o fluxo authorization_code/refresh_token existente
// (src/lib/meli-api.server.ts + meli_api_conexoes). É um módulo server-only,
// desligado, preparado para o futuro uso da API oficial de carrier.
//
// Regras: credenciais lidas somente dentro da chamada; nunca logar token,
// client secret ou header Authorization; cache/dedupe por audience.
// ─────────────────────────────────────────────────────────────────────────────

const RENOVACAO_PREVENTIVA_MS = 5 * 60_000;
const EXPIRES_IN_PADRAO_S = 21_600;

export type ClientCredentialsToken = {
  accessToken: string;
  audience: string;
  /** Epoch ms de expiração informado pelo provedor. */
  expiresAt: number;
};

export type ClientCredentialsDeps = {
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export class MeliClientCredentialsError extends Error {
  status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "MeliClientCredentialsError";
    this.status = status;
  }
}

type CacheEntry = { token: ClientCredentialsToken };

const cache = new Map<string, CacheEntry>();
const emVoo = new Map<string, Promise<ClientCredentialsToken>>();

function base64(value: string): string {
  if (typeof btoa === "function") return btoa(value);
  // Fallback server-side (Node/Workers com Buffer disponível).
  return Buffer.from(value, "utf8").toString("base64");
}

function credenciais(): { clientId: string; clientSecret: string } {
  const clientId = process.env["MELI_CLIENT_ID"];
  const clientSecret = process.env["MELI_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    throw new MeliClientCredentialsError(
      "Credenciais da aplicação Meli não configuradas (MELI_CLIENT_ID/MELI_CLIENT_SECRET).",
    );
  }
  return { clientId, clientSecret };
}

/**
 * URL do endpoint de token — obrigatória, lida dentro da chamada.
 * Sem default: nenhum host é assumido. Precisa ser HTTPS absoluta.
 * O valor configurado nunca é ecoado na mensagem de erro.
 */
function tokenUrl(): string {
  const configurado = (process.env["MELI_TOKEN_URL"] ?? "").trim();
  if (!configurado) {
    throw new MeliClientCredentialsError(
      "Endpoint de autorização Meli não configurado (MELI_TOKEN_URL).",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(configurado);
  } catch {
    throw new MeliClientCredentialsError(
      "MELI_TOKEN_URL inválida: informe uma URL HTTPS absoluta.",
    );
  }
  if (parsed.protocol !== "https:") {
    throw new MeliClientCredentialsError("MELI_TOKEN_URL inválida: use o esquema HTTPS.");
  }
  return parsed.toString();
}

async function solicitarToken(
  audience: string,
  deps: ClientCredentialsDeps,
): Promise<ClientCredentialsToken> {
  const { clientId, clientSecret } = credenciais();
  // Validado fora do try do fetch para não ser confundido com erro de rede.
  const url = tokenUrl();
  const doFetch = deps.fetchImpl ?? fetch;
  const agora = (deps.now ?? Date.now)();

  let response: Response;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Basic ${base64(`${clientId}:${clientSecret}`)}`,
      },
      body: JSON.stringify({ audience, grant_type: "client_credentials" }),
    });
  } catch {
    // Nunca propagar detalhes de rede que possam conter a requisição/segredo.
    throw new MeliClientCredentialsError(
      "Não foi possível contatar o serviço de autorização do Mercado Livre.",
    );
  }

  if (!response.ok) {
    // Nenhum corpo bruto é lido/propagado: pode conter dados sensíveis.
    throw new MeliClientCredentialsError(
      `O serviço de autorização do Mercado Livre recusou a solicitação (HTTP ${response.status}).`,
      response.status,
    );
  }

  let corpo: unknown;
  try {
    corpo = await response.json();
  } catch {
    throw new MeliClientCredentialsError("Resposta de autorização inválida do Mercado Livre.");
  }

  const dados = corpo as { access_token?: unknown; expires_in?: unknown } | null;
  const accessToken = typeof dados?.access_token === "string" ? dados.access_token : "";
  if (!accessToken) {
    throw new MeliClientCredentialsError("Resposta de autorização sem token de acesso.");
  }
  const expiresIn =
    typeof dados?.expires_in === "number" && Number.isFinite(dados.expires_in) && dados.expires_in > 0
      ? dados.expires_in
      : EXPIRES_IN_PADRAO_S;

  return { accessToken, audience, expiresAt: agora + expiresIn * 1000 };
}

/**
 * Obtém (ou reutiliza) um access token client_credentials para a audience dada.
 * Renova preventivamente 5 minutos antes do vencimento e deduplica chamadas
 * concorrentes por audience.
 */
export function obterClientCredentialsToken(
  audience: string,
  deps: ClientCredentialsDeps = {},
): Promise<ClientCredentialsToken> {
  const alvo = (audience ?? "").trim();
  if (!alvo) {
    return Promise.reject(
      new MeliClientCredentialsError("Informe a audience da API Meli desejada."),
    );
  }

  const agora = (deps.now ?? Date.now)();
  const cached = cache.get(alvo);
  if (cached && cached.token.expiresAt - RENOVACAO_PREVENTIVA_MS > agora) {
    return Promise.resolve(cached.token);
  }

  const pendente = emVoo.get(alvo);
  if (pendente) return pendente;

  const promessa = solicitarToken(alvo, deps)
    .then((token) => {
      cache.set(alvo, { token });
      return token;
    })
    .finally(() => {
      emVoo.delete(alvo);
    });

  emVoo.set(alvo, promessa);
  return promessa;
}

/** Limpa o cache (uma audience ou todas). Uso em testes/manutenção. */
export function limparClientCredentialsCache(audience?: string): void {
  if (audience) {
    cache.delete(audience);
    emVoo.delete(audience);
    return;
  }
  cache.clear();
  emVoo.clear();
}
