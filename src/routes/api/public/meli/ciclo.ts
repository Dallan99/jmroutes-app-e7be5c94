// Endpoint público do ciclo de sincronização Meli (protocolo de lotes).
// Ações: iniciar | finalizar | abandonar.
//
// Regras:
// - Exige Bearer token do usuário técnico/operador (nunca service_role).
// - Toda a lógica de validação, advisory lock e promoção vive nas RPCs
//   SECURITY DEFINER; aqui só há transporte e validação de forma.
// - Enquanto a migration não estiver aplicada, as RPCs não existem e o endpoint
//   responde 503 com codigo "protocolo_indisponivel" — o worker então segue no
//   fluxo legado sem interromper a integração.
import { createFileRoute } from "@tanstack/react-router";
import {
  MAX_BODY_BYTES,
  clienteDoUsuario,
  corsHeaders,
  extrairBearer,
  isAllowedOrigin,
  isUuid,
  json,
} from "@/lib/meli-api-http";

const ACOES = ["iniciar", "finalizar", "abandonar"] as const;
type Acao = (typeof ACOES)[number];

const ESTADOS_WORKER = ["concluido", "parcial", "erro"] as const;

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

function rpcIndisponivel(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("could not find the function") ||
    m.includes("does not exist") ||
    m.includes("schema cache")
  );
}

export const Route = createFileRoute("/api/public/meli/ciclo")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        const origin = request.headers.get("origin");
        if (!isAllowedOrigin(origin)) return new Response(null, { status: 403 });
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      },

      GET: async ({ request }) => {
        const origin = request.headers.get("origin");
        return json(
          { ok: false, codigo: "metodo_nao_permitido", mensagem: "Use POST." },
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

        const token = extrairBearer(request);
        if (!token) {
          return json(
            { ok: false, codigo: "nao_autenticado", mensagem: "Autenticação obrigatória." },
            401,
            origin,
          );
        }

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

        const b = body as Record<string, unknown>;
        const acao = b["acao"];
        if (typeof acao !== "string" || !ACOES.includes(acao as Acao)) {
          return json(
            { ok: false, codigo: "acao_invalida", mensagem: "Campo 'acao' deve ser iniciar, finalizar ou abandonar." },
            400,
            origin,
          );
        }
        const syncBatchId = b["sync_batch_id"];
        if (!isUuid(syncBatchId)) {
          return json(
            { ok: false, codigo: "sync_batch_id_invalido", mensagem: "Campo 'sync_batch_id' deve ser um UUID." },
            400,
            origin,
          );
        }

        const baseCodigo = b["base_codigo"];
        if (acao !== "abandonar" && (typeof baseCodigo !== "string" || baseCodigo.trim() === "")) {
          return json(
            { ok: false, codigo: "base_codigo_obrigatorio", mensagem: "Campo 'base_codigo' obrigatório." },
            400,
            origin,
          );
        }

        const dataOperacional = b["data_operacional"];
        if (dataOperacional !== undefined && dataOperacional !== null) {
          if (typeof dataOperacional !== "string" || !DATA_RE.test(dataOperacional)) {
            return json(
              { ok: false, codigo: "data_invalida", mensagem: "Campo 'data_operacional' deve ser AAAA-MM-DD." },
              400,
              origin,
            );
          }
        }

        const inteiroOuNulo = (v: unknown): number | null =>
          typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;

        const cliente = await clienteDoUsuario(token);
        if (cliente.status === "config") {
          return json({ ok: false, codigo: "config", mensagem: "Servidor mal configurado." }, 500, origin);
        }
        if (cliente.status === "nao_autenticado") {
          return json(
            { ok: false, codigo: "nao_autenticado", mensagem: "Autenticação inválida." },
            401,
            origin,
          );
        }

        let fn: string;
        let args: Record<string, unknown>;
        if (acao === "iniciar") {
          fn = "meli_sync_ciclo_iniciar";
          args = {
            p_sync_batch_id: syncBatchId,
            p_base_codigo: String(baseCodigo).trim(),
            p_data_operacional: (dataOperacional as string | undefined) ?? null,
            p_origem: typeof b["origem"] === "string" ? b["origem"] : "worker",
            p_rotas_esperadas: inteiroOuNulo(b["rotas_esperadas"]),
          };
        } else if (acao === "finalizar") {
          const estado = typeof b["estado"] === "string" ? b["estado"] : "concluido";
          if (!ESTADOS_WORKER.includes(estado as (typeof ESTADOS_WORKER)[number])) {
            return json(
              { ok: false, codigo: "estado_invalido", mensagem: "Campo 'estado' inválido." },
              400,
              origin,
            );
          }
          fn = "meli_sync_ciclo_finalizar";
          args = {
            p_sync_batch_id: syncBatchId,
            p_base_codigo: String(baseCodigo).trim(),
            p_data_operacional: (dataOperacional as string | undefined) ?? null,
            p_rotas: inteiroOuNulo(b["rotas"]),
            p_pacotes: inteiroOuNulo(b["pacotes"]),
            p_estado: estado,
            p_mensagem: typeof b["mensagem"] === "string" ? b["mensagem"].slice(0, 300) : null,
          };
        } else {
          fn = "meli_sync_ciclo_abandonar";
          args = {
            p_sync_batch_id: syncBatchId,
            p_mensagem: typeof b["mensagem"] === "string" ? b["mensagem"].slice(0, 300) : null,
          };
        }

        try {
          const { data, error } = await cliente.supabase.rpc(fn, args);
          if (error) {
            if (rpcIndisponivel(error.message)) {
              return json(
                {
                  ok: false,
                  codigo: "protocolo_indisponivel",
                  mensagem: "Protocolo de lotes ainda não disponível neste ambiente.",
                },
                503,
                origin,
              );
            }
            const m = error.message.toLowerCase();
            if (m.includes("permission") || m.includes("sem_permissao")) {
              return json(
                { ok: false, codigo: "sem_permissao", mensagem: "Sem permissão para operar ciclos." },
                403,
                origin,
              );
            }
            return json({ ok: false, codigo: "erro_ciclo", mensagem: error.message }, 400, origin);
          }

          const res = (data ?? {}) as Record<string, unknown>;
          const status = typeof res["status"] === "string" ? res["status"] : "erro";
          if (status === "erro") {
            const erro = String(res["erro"] ?? "erro_ciclo");
            const httpStatus = erro === "sem_permissao" || erro === "sem_acesso_a_base" ? 403 : 400;
            return json({ ok: false, codigo: erro, mensagem: erro, resultado: res }, httpStatus, origin);
          }

          return json({ ok: true, acao, resultado: res }, 200, origin);
        } catch (err) {
          console.error("[/api/public/meli/ciclo] erro", err);
          return json(
            { ok: false, codigo: "erro_interno", mensagem: "Falha ao processar o ciclo." },
            500,
            origin,
          );
        }
      },
    },
  },
});
