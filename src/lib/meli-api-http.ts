// Helpers HTTP compartilhados pelos endpoints públicos do Meli
// (/api/public/meli/importar-rota-bruta e /api/public/meli/ciclo).
// Nenhum segredo é lido em escopo de módulo — apenas dentro das funções.
import { createClient } from "@supabase/supabase-js";

export const MAX_BODY_BYTES = 5 * 1024 * 1024;

const ALLOWED_ORIGIN_HOSTS = new Set(["jmroutes.app", "www.jmroutes.app"]);

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (origin.startsWith("chrome-extension://")) return true;
  try {
    const u = new URL(origin);
    if (ALLOWED_ORIGIN_HOSTS.has(u.hostname)) return true;
    if (u.hostname.endsWith(".lovable.app")) return true;
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return true;
  } catch {
    return false;
  }
  return false;
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && isAllowedOrigin(origin) ? origin : "null";
  return {
    "Access-Control-Allow-Origin": allow,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
    },
  });
}

function isNewSupabaseApiKey(v: string): boolean {
  return v.startsWith("sb_publishable_") || v.startsWith("sb_secret_");
}

export function createSupabaseFetch(key: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    }
    if (isNewSupabaseApiKey(key) && headers.get("Authorization") === `Bearer ${key}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", key);
    return fetch(input, { ...init, headers });
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** Extrai o Bearer JWT do usuário. Nunca aceita chaves de API no lugar do token. */
export function extrairBearer(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token || token.split(".").length !== 3) return null;
  return token;
}

/** Cliente mínimo estrutural: só o que os endpoints usam. */
export type SupabaseRpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export type ClienteAutenticado =
  | { status: "ok"; supabase: SupabaseRpcClient; userId: string }
  | { status: "config" }
  | { status: "nao_autenticado" };

/**
 * Cliente Supabase agindo COMO o usuário do token (RLS aplicada).
 * Nunca usa service_role.
 */
export async function clienteDoUsuario(token: string): Promise<ClienteAutenticado> {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return { status: "config" };

  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: {
      fetch: createSupabaseFetch(SUPABASE_PUBLISHABLE_KEY),
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  const { data: claims, error } = await supabase.auth.getClaims(token);
  const sub = claims?.claims?.sub;
  if (error || !sub) return { status: "nao_autenticado" };
  return { status: "ok", supabase: supabase as unknown as SupabaseRpcClient, userId: String(sub) };
}
