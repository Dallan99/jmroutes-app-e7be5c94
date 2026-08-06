// Camada de autenticação do worker.
// A) AdminML: transporte HTTP a partir do storageState cifrado (Playwright).
//    Modular: qualquer implementação de MeliTransport (ex.: endpoint corporativo
//    XPT autorizado) pode substituir o Playwright sem alterar o pipeline.
// B) JMRoutes: sessão Supabase do usuário técnico (Bearer). NUNCA service_role.
import type { APIRequestContext, Browser } from "playwright";
import { ADMINML, type WorkerConfig } from "../config";
import { logger, mensagemSegura } from "../logger";
import { carregarSessao } from "../session/store";
import type { MeliResposta, MeliTransport } from "../meli/list";

// ------------------------------------------------------------------
// A) AdminML
// ------------------------------------------------------------------
export type AdminMLSessao =
  | { status: "ok"; transport: MeliTransport; fechar: () => Promise<void> }
  | { status: "aguardando_autenticacao"; motivo: string };

function toHeaders(res: { headers(): Record<string, string> }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers())) out[k.toLowerCase()] = v;
  return out;
}

async function respostaDe(res: {
  status(): number;
  headers(): Record<string, string>;
  text(): Promise<string>;
}): Promise<MeliResposta> {
  const headers = toHeaders(res);
  const status = res.status();
  let body: unknown = null;
  const ct = (headers["content-type"] ?? "").toLowerCase();
  if (ct.includes("json")) {
    const raw = await res.text();
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
  }
  const ok = status >= 200 && status < 300 && body !== null;
  return { status, headers, body, ok };
}

export function transportDeRequestContext(request: APIRequestContext): MeliTransport {
  return {
    async post(url, body) {
      const res = await request.post(url, {
        data: body,
        timeout: ADMINML.TIMEOUT_MS,
        headers: { Accept: "application/json, text/plain, */*", "Content-Type": "application/json" },
      });
      return respostaDe(res);
    },
    async get(url) {
      const res = await request.get(url, {
        timeout: ADMINML.TIMEOUT_MS,
        headers: { Accept: "application/json, text/plain, */*" },
      });
      return respostaDe(res);
    },
  };
}

/** Abre um contexto AdminML autenticado usando a sessão cifrada em disco. */
export async function abrirSessaoAdminML(cfg: WorkerConfig): Promise<AdminMLSessao> {
  const leitura = await carregarSessao(cfg.sessionFilePath, cfg.sessionKeyBase64);
  if (leitura.status !== "ok") {
    return { status: "aguardando_autenticacao", motivo: leitura.motivo };
  }

  const { chromium } = await import("playwright");
  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    // storageState é passado em memória — nunca é escrito em claro no disco.
    storageState: leitura.storageState as never,
  });

  return {
    status: "ok",
    transport: transportDeRequestContext(context.request),
    fechar: async () => {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    },
  };
}

// ------------------------------------------------------------------
// B) JMRoutes / Supabase
// ------------------------------------------------------------------
export type JmrSessao = {
  accessToken: string;
  refreshToken: string | null;
  expiraEm: number;
};

export type JmrAuthResultado =
  | { status: "ok"; sessao: JmrSessao }
  | { status: "jmroutes_sem_sessao"; motivo: string };

type TokenResposta = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

async function chamarToken(
  cfg: WorkerConfig,
  grant: "password" | "refresh_token",
  corpo: Record<string, string>,
): Promise<JmrAuthResultado> {
  try {
    const res = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=${grant}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: cfg.supabaseAnonKey,
      },
      body: JSON.stringify(corpo),
    });
    if (!res.ok) {
      return { status: "jmroutes_sem_sessao", motivo: `token_http_${res.status}` };
    }
    const data = (await res.json()) as TokenResposta;
    if (!data.access_token) return { status: "jmroutes_sem_sessao", motivo: "token_ausente" };
    return {
      status: "ok",
      sessao: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? null,
        expiraEm: Date.now() + (data.expires_in ?? 3600) * 1000,
      },
    };
  } catch (err) {
    // Nunca registra senha nem token.
    logger.warn("Falha ao autenticar no JMRoutes.", {
      erro: mensagemSegura(String((err as Error)?.message ?? err)),
    });
    return { status: "jmroutes_sem_sessao", motivo: "network" };
  }
}

export function autenticarJmroutes(cfg: WorkerConfig): Promise<JmrAuthResultado> {
  return chamarToken(cfg, "password", { email: cfg.workerEmail, password: cfg.workerPassword });
}

export function renovarJmroutes(cfg: WorkerConfig, refreshToken: string): Promise<JmrAuthResultado> {
  return chamarToken(cfg, "refresh_token", { refresh_token: refreshToken });
}

export function sessaoValida(sessao: JmrSessao | null, agora = Date.now()): boolean {
  return !!sessao && sessao.expiraEm - agora > 60_000;
}

/** Garante sessão JMRoutes válida: renova quando possível, senão reautentica. */
export async function garantirSessaoJmroutes(
  cfg: WorkerConfig,
  atual: JmrSessao | null,
): Promise<JmrAuthResultado> {
  if (sessaoValida(atual)) return { status: "ok", sessao: atual as JmrSessao };
  if (atual?.refreshToken) {
    const renovada = await renovarJmroutes(cfg, atual.refreshToken);
    if (renovada.status === "ok") return renovada;
  }
  return autenticarJmroutes(cfg);
}
