// Endpoint público para a extensão Chrome "JM Routes Importador".
// Reutiliza o mesmo helper usado pela server function meliImportarRotaBruta.
// - Exige Bearer token do usuário autenticado (não usa service_role).
// - CORS restrito à origem chrome-extension:// e ao próprio domínio JMRoutes.
// - Body JSON limitado a 5 MB.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { importarRotaBrutaComClient } from "@/lib/meli-import-bruto";

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const ALLOWED_ORIGIN_HOSTS = new Set([
  "jmroutes.app",
  "www.jmroutes.app",
]);

function isAllowedOrigin(origin: string | null): boolean {
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

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && isAllowedOrigin(origin) ? origin : "null";
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
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

function createSupabaseFetch(key: string): typeof fetch {
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

export const Route = createFileRoute("/api/public/meli/importar-rota-bruta")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        const origin = request.headers.get("origin");
        if (!isAllowedOrigin(origin)) {
          return new Response(null, { status: 403 });
        }
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      },

      GET: async ({ request }) => {
        const origin = request.headers.get("origin");
        return json(
          { ok: false, codigo: "metodo_nao_permitido", mensagem: "Use POST para importar rotas." },
          405,
          origin,
        );
      },



      POST: async ({ request }) => {
        const origin = request.headers.get("origin");

        if (origin && !isAllowedOrigin(origin)) {
          return json({ ok: false, codigo: "origem_nao_permitida", mensagem: "Origem não permitida." }, 403, origin);
        }

        const ct = request.headers.get("content-type") ?? "";
        if (!ct.toLowerCase().includes("application/json")) {
          return json({ ok: false, codigo: "content_type", mensagem: "Content-Type inválido." }, 415, origin);
        }

        const cl = request.headers.get("content-length");
        if (cl && Number(cl) > MAX_BODY_BYTES) {
          return json({ ok: false, codigo: "body_muito_grande", mensagem: "Payload excede o limite." }, 413, origin);
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
          return json(
            { ok: false, codigo: "nao_autenticado", mensagem: "Faça login no JMRoutes e tente novamente." },
            401,
            origin,
          );
        }
        const token = authHeader.slice(7).trim();
        if (!token || token.split(".").length !== 3) {
          return json(
            { ok: false, codigo: "nao_autenticado", mensagem: "Faça login no JMRoutes e tente novamente." },
            401,
            origin,
          );
        }

        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return json({ ok: false, codigo: "config", mensagem: "Servidor mal configurado." }, 500, origin);
        }

        // Lê o body com limite manual defensivo.
        const raw = await request.text();
        if (raw.length > MAX_BODY_BYTES) {
          return json({ ok: false, codigo: "body_muito_grande", mensagem: "Payload excede o limite." }, 413, origin);
        }

        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          return json({ ok: false, codigo: "json_invalido", mensagem: "JSON inválido." }, 400, origin);
        }

        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return json({ ok: false, codigo: "body_invalido", mensagem: "Body inválido." }, 400, origin);
        }
        const { payload, confirmar_divergencia, origem } = body as {
          payload?: unknown;
          confirmar_divergencia?: unknown;
          origem?: unknown;
        };
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          return json({ ok: false, codigo: "payload_invalido", mensagem: "Campo 'payload' ausente ou inválido." }, 400, origin);
        }

        // Campo opcional e aditivo: identifica quem enviou a rota.
        // Default "extensao" — a extensão v0.3.1 continua funcionando sem alteração.
        const ORIGENS_VALIDAS = ["extensao", "worker", "manual"] as const;
        type OrigemImportacao = (typeof ORIGENS_VALIDAS)[number];
        let origemImportacao: OrigemImportacao = "extensao";
        if (origem !== undefined && origem !== null) {
          if (typeof origem !== "string" || !ORIGENS_VALIDAS.includes(origem as OrigemImportacao)) {
            return json(
              { ok: false, codigo: "origem_invalida", mensagem: "Campo 'origem' inválido." },
              400,
              origin,
            );
          }
          origemImportacao = origem as OrigemImportacao;
        }
        const ARQUIVO_POR_ORIGEM: Record<OrigemImportacao, string> = {
          extensao: "extensao-chrome",
          worker: "worker-meli",
          manual: "envio-manual",
        };


        const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: {
            fetch: createSupabaseFetch(SUPABASE_PUBLISHABLE_KEY),
            headers: { Authorization: `Bearer ${token}` },
          },
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });

        const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
        if (claimsErr || !claims?.claims?.sub) {
          return json(
            { ok: false, codigo: "nao_autenticado", mensagem: "Faça login no JMRoutes e tente novamente." },
            401,
            origin,
          );
        }

        try {
          const result = await importarRotaBrutaComClient(
            supabase as never,
            payload as Record<string, unknown>,
            {
              confirmar_divergencia: confirmar_divergencia === true,
              arquivo_nome: ARQUIVO_POR_ORIGEM[origemImportacao],
            },
          );

          // Mapeia erros de permissão da RPC.
          if (result.status === "erro") {
            const msg = (result.erro ?? "").toLowerCase();
            if (msg.includes("sem_permissao") || msg.includes("permission")) {
              return json(
                { ok: false, codigo: "sem_permissao", mensagem: "Seu perfil não possui permissão para importar rotas." },
                403,
                origin,
              );
            }
            if (result.alerta_divergencia && result.resumo) {
              return json(
                {
                  ok: false,
                  requer_confirmacao: true,
                  alerta_divergencia: true,
                  route_id: result.resumo.route_id,
                  total_meli: result.resumo.total_informado,
                  total_extraido: result.resumo.total_extraidos,
                  diferenca: result.resumo.diferenca,
                  mensagem: "Há divergência entre o total informado pelo Meli e o total extraído.",
                },
                200,
                origin,
              );
            }
            return json(
              { ok: false, codigo: "erro_importacao", mensagem: result.erro ?? "Falha ao importar." },
              400,
              origin,
            );
          }

          return json(
            {
              ok: true,
              route_id: result.route_id ?? result.rota_id ?? null,
              recebidos: result.pacotes_recebidos ?? 0,
              inseridos: result.pacotes_inseridos ?? 0,
              atualizados: result.pacotes_atualizados ?? 0,
              inalterados: result.pacotes_inalterados ?? 0,
              invalidos: result.pacotes_invalidos ?? 0,
              duplicados: result.pacotes_duplicados_no_payload ?? 0,
              ordem_invalida: result.pacotes_com_ordem_invalida ?? 0,
              alerta_divergencia: null,
              mensagem: "Rota importada com sucesso",
            },
            200,
            origin,
          );
        } catch (err) {
          console.error("[/api/public/meli/importar-rota-bruta] erro", err);
          return json(
            { ok: false, codigo: "erro_interno", mensagem: "Não foi possível importar a rota. Tente novamente." },
            500,
            origin,
          );
        }
      },
    },
  },
});
