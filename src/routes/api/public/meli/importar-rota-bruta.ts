// Endpoint público para a extensão Chrome "JM Routes Importador".
// Reutiliza o mesmo helper usado pela server function meliImportarRotaBruta.
// - Exige Bearer token do usuário autenticado (não usa service_role).
// - CORS restrito à origem chrome-extension:// e ao próprio domínio JMRoutes.
// - Body JSON limitado a 5 MB.
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
import {
  codigoSeguroErroImportacao,
  enviarRotaParaStagingComClient,
  importarRotaBrutaComClient,
} from "@/lib/meli-import-bruto";

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

        const token = extrairBearer(request);
        if (!token) {
          return json(
            { ok: false, codigo: "nao_autenticado", mensagem: "Faça login no JMRoutes e tente novamente." },
            401,
            origin,
          );
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
        const { payload, confirmar_divergencia, origem, sync_batch_id } = body as {
          payload?: unknown;
          confirmar_divergencia?: unknown;
          origem?: unknown;
          sync_batch_id?: unknown;
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

        // Protocolo de lotes: quando presente, a rota vai APENAS para o staging
        // do ciclo. Ausente = fluxo legado, inalterado.
        if (sync_batch_id !== undefined && sync_batch_id !== null && !isUuid(sync_batch_id)) {
          return json(
            { ok: false, codigo: "sync_batch_id_invalido", mensagem: "Campo 'sync_batch_id' deve ser um UUID." },
            400,
            origin,
          );
        }

        const cliente = await clienteDoUsuario(token);
        if (cliente.status === "config") {
          return json({ ok: false, codigo: "config", mensagem: "Servidor mal configurado." }, 500, origin);
        }
        if (cliente.status === "nao_autenticado") {
          return json(
            { ok: false, codigo: "nao_autenticado", mensagem: "Faça login no JMRoutes e tente novamente." },
            401,
            origin,
          );
        }
        const supabase = cliente.supabase;

        if (isUuid(sync_batch_id)) {
          try {
            const st = await enviarRotaParaStagingComClient(
              supabase as never,
              sync_batch_id,
              payload as Record<string, unknown>,
            );
            if (st.status === "erro") {
              const msg = st.erro.toLowerCase();
              if (msg.includes("could not find the function") || msg.includes("schema cache")) {
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
              const httpStatus =
                msg.includes("sem_permissao") || msg.includes("sem_acesso") || msg.includes("permission")
                  ? 403
                  : 400;
              return json({ ok: false, codigo: st.erro, mensagem: st.erro }, httpStatus, origin);
            }
            return json(
              {
                ok: true,
                staging: true,
                sync_batch_id,
                route_id: st.route_id,
                rotas_no_lote: st.rotas_no_lote,
                pacotes_no_lote: st.pacotes_no_lote,
                total_meli: st.resumo?.total_informado ?? null,
                total_extraido: st.resumo?.total_extraidos ?? null,
                diferenca: st.resumo?.diferenca ?? null,
                mensagem: "Rota gravada no lote em construção",
              },
              200,
              origin,
            );
          } catch (err) {
            console.error("[/api/public/meli/importar-rota-bruta] staging", err);
            return json(
              { ok: false, codigo: "erro_interno", mensagem: "Não foi possível gravar a rota no lote." },
              500,
              origin,
            );
          }
        }

        try {
          const result = await importarRotaBrutaComClient(
            supabase as never,
            payload as Record<string, unknown>,
            {
              confirmar_divergencia: confirmar_divergencia === true,
              aceitar_divergencia_automatica: origemImportacao === "worker",
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
              {
                ok: false,
                codigo: codigoSeguroErroImportacao(result.erro),
                mensagem: "A rota não pôde ser importada.",
              },
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
              alerta_divergencia: result.alerta_divergencia ?? false,
              total_meli: result.resumo?.total_informado ?? null,
              total_extraido: result.resumo?.total_extraidos ?? null,
              diferenca: result.resumo?.diferenca ?? null,
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
