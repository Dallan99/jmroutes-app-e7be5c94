import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { normalizarCodigoTriagem } from "./triagem-domain";

const baseDiaSchema = z.object({
  baseId: z.string().uuid(),
  dataOperacional: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const iniciarSchema = baseDiaSchema.extend({
  rota: z.string().trim().min(1).max(120),
  motoristaMeliId: z.string().trim().min(1).max(80),
  motorista: z.string().trim().min(2).max(160),
});

export type MotoristaMeli = { id: string; nome: string; ultimaRotaEm: string | null };

export const listarMotoristasMeli = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((entrada: unknown) => z.object({ baseId: z.string().uuid() }).parse(entrada))
  .handler(async ({ data }): Promise<MotoristaMeli[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: linhas, error } = await supabaseAdmin
      .from("meli_rotas")
      .select("driver_id, driver_name, data_rota")
      .eq("base_id", data.baseId)
      .not("driver_name", "is", null)
      .order("data_rota", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);
    const catalogo = new Map<string, MotoristaMeli>();
    for (const linha of linhas ?? []) {
      const nome = linha.driver_name?.trim();
      if (!nome) continue;
      const id = linha.driver_id?.trim() || `nome:${nome.toLocaleLowerCase("pt-BR")}`;
      if (!catalogo.has(id)) catalogo.set(id, { id, nome, ultimaRotaEm: linha.data_rota ?? null });
    }
    return [...catalogo.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  });

const biparSchema = z.object({
  expedicaoId: z.string().uuid(),
  codigo: z.string().trim().min(3).max(120).transform(normalizarCodigoTriagem),
});

const concluirSchema = z.object({
  expedicaoId: z.string().uuid(),
  responsavelMeliSvc: z.string().trim().max(160).optional(),
  outroResponsavel: z.string().trim().max(160).optional(),
  observacao: z.string().trim().max(1000).optional(),
  confirmarComFaltantes: z.boolean().default(false),
});

type LinhaEscala = {
  id: string;
  shipment: string | null;
  planejada: string | null;
  otimizada: string | null;
  triado: boolean | null;
};

export type RotaExpedicao = {
  rota: string;
  previstos: number;
  recebidos: number;
  faltantesRecebimento: number;
  pronta: boolean;
  expedicao: null | {
    id: string;
    status: string;
    motorista: string | null;
    conferidos: number;
  };
};

function rotaEfetiva(linha: Pick<LinhaEscala, "planejada" | "otimizada">) {
  return linha.otimizada?.trim() || linha.planejada?.trim() || null;
}

async function carregarEscalas(
  supabase: SupabaseClient<Database>,
  importacaoId: string,
): Promise<LinhaEscala[]> {
  const resultado: LinhaEscala[] = [];
  const pagina = 1000;
  for (let inicio = 0; ; inicio += pagina) {
    const { data, error } = await supabase
      .from("escalas")
      .select("id, shipment, planejada, otimizada, triado")
      .eq("importacao_id", importacaoId)
      .not("shipment", "is", null)
      .neq("shipment", "")
      .order("id", { ascending: true })
      .range(inicio, inicio + pagina - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    resultado.push(...(data as LinhaEscala[]));
    if (data.length < pagina) break;
  }
  return resultado;
}

export const listarRotasExpedicao = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((entrada: unknown) => baseDiaSchema.parse(entrada))
  .handler(async ({ data, context }): Promise<RotaExpedicao[]> => {
    const { supabase } = context;
    const { data: importacao, error } = await supabase
      .from("importacoes_escala")
      .select("id")
      .eq("base_id", data.baseId)
      .eq("data_operacional", data.dataOperacional)
      .eq("ativa", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!importacao) return [];

    const [linhas, expedicoes, conclusoes] = await Promise.all([
      carregarEscalas(supabase, importacao.id),
      supabase
        .from("expedicoes")
        .select("id, rota, status, motorista, quantidade_conferida")
        .eq("importacao_id", importacao.id),
      (async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        return supabaseAdmin
          .from("audit_logs")
          .select("detalhes")
          .eq("acao", "triagem.rota_concluida_ressalva")
          .eq("entidade_id", importacao.id);
      })(),
    ]);
    if (expedicoes.error) throw new Error(expedicoes.error.message);

    const porRota = new Map<string, { previstos: number; recebidos: number }>();
    for (const linha of linhas) {
      const rota = rotaEfetiva(linha);
      if (!rota) continue;
      const atual = porRota.get(rota) ?? { previstos: 0, recebidos: 0 };
      atual.previstos += 1;
      if (linha.triado) atual.recebidos += 1;
      porRota.set(rota, atual);
    }

    const ressalvas = new Set(
      (conclusoes.data ?? [])
        .map((item) => (item.detalhes as Record<string, unknown> | null)?.rota)
        .filter((rota): rota is string => typeof rota === "string"),
    );
    const expedicaoPorRota = new Map((expedicoes.data ?? []).map((item) => [item.rota, item]));

    return Array.from(porRota.entries())
      .map(([rota, contagem]) => {
        const expedicao = expedicaoPorRota.get(rota);
        return {
          rota,
          previstos: contagem.previstos,
          recebidos: contagem.recebidos,
          faltantesRecebimento: Math.max(contagem.previstos - contagem.recebidos, 0),
          pronta: contagem.previstos === contagem.recebidos || ressalvas.has(rota),
          expedicao: expedicao
            ? {
                id: expedicao.id,
                status: expedicao.status,
                motorista: expedicao.motorista,
                conferidos: expedicao.quantidade_conferida,
              }
            : null,
        };
      })
      .filter((rota) => rota.pronta)
      .sort((a, b) => a.rota.localeCompare(b.rota, "pt-BR", { numeric: true }));
  });

export const iniciarExpedicao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((entrada: unknown) => iniciarSchema.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: importacao, error: importacaoErro } = await supabase
      .from("importacoes_escala")
      .select("id")
      .eq("base_id", data.baseId)
      .eq("data_operacional", data.dataOperacional)
      .eq("ativa", true)
      .single();
    if (importacaoErro) throw new Error(importacaoErro.message);

    const linhas = (await carregarEscalas(supabase, importacao.id)).filter(
      (linha) => rotaEfetiva(linha) === data.rota,
    );
    if (!linhas.length) throw new Error("Rota não encontrada na importação ativa.");
    const recebidos = linhas.filter((linha) => linha.triado).length;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ressalva } = await supabaseAdmin
      .from("audit_logs")
      .select("id")
      .eq("acao", "triagem.rota_concluida_ressalva")
      .eq("entidade_id", importacao.id)
      .contains("detalhes", { rota: data.rota } as never)
      .limit(1)
      .maybeSingle();
    if (recebidos !== linhas.length && !ressalva) {
      throw new Error("A rota ainda não foi concluída no Recebimento.");
    }

    const { data: existente, error: existenteErro } = await supabase
      .from("expedicoes")
      .select("id, status, motorista, quantidade_conferida")
      .eq("importacao_id", importacao.id)
      .eq("rota", data.rota)
      .maybeSingle();
    if (existenteErro) throw new Error(existenteErro.message);
    if (existente) {
      return {
        id: existente.id,
        status: existente.status,
        motorista: existente.motorista,
        conferidos: existente.quantidade_conferida,
      };
    }

    const { data: usuarioMotorista } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("meli_driver_id", data.motoristaMeliId)
      .eq("ativo", true)
      .maybeSingle();

    const { data: criada, error } = await supabase
      .from("expedicoes")
      .insert({
        base_id: data.baseId,
        importacao_id: importacao.id,
        data_operacional: data.dataOperacional,
        rota: data.rota,
        quantidade_prevista: linhas.length,
        responsavel_expedicao_id: userId,
        motorista: data.motorista,
        motorista_meli_id: data.motoristaMeliId,
        motorista_usuario_id: usuarioMotorista?.id ?? null,
        iniciada_por: userId,
      })
      .select("id, status, motorista, quantidade_conferida")
      .single();
    if (error) throw new Error(error.message);
    return {
      id: criada.id,
      status: criada.status,
      motorista: criada.motorista,
      conferidos: criada.quantidade_conferida,
    };
  });

export const listarMinhasExpedicoesMotorista = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: perfil, error: perfilErro } = await supabaseAdmin
      .from("profiles")
      .select("meli_driver_id")
      .eq("id", context.userId)
      .single();
    if (perfilErro) throw new Error(perfilErro.message);
    if (!perfil.meli_driver_id) return [];
    const { data, error } = await supabaseAdmin
      .from("expedicoes")
      .select("id, rota, motorista, status, quantidade_prevista, quantidade_conferida, data_operacional, bases(codigo, nome)")
      .eq("motorista_meli_id", perfil.meli_driver_id)
      .order("data_operacional", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const detalharExpedicao = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((entrada: unknown) => z.object({ expedicaoId: z.string().uuid() }).parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: expedicao, error } = await supabase
      .from("expedicoes")
      .select("*")
      .eq("id", data.expedicaoId)
      .single();
    if (error) throw new Error(error.message);
    const { data: leituras, error: leiturasErro } = await supabase
      .from("expedicao_leituras")
      .select("shipment, created_at, localizado_posteriormente_na_expedicao")
      .eq("expedicao_id", data.expedicaoId)
      .eq("resultado", "ok")
      .order("created_at", { ascending: false });
    if (leiturasErro) throw new Error(leiturasErro.message);
    return { expedicao, leituras: leituras ?? [] };
  });

export const biparExpedicao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((entrada: unknown) => biparSchema.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: expedicao, error } = await supabase
      .from("expedicoes")
      .select("id, importacao_id, rota, status, quantidade_prevista, quantidade_conferida")
      .eq("id", data.expedicaoId)
      .single();
    if (error) throw new Error(error.message);
    if (expedicao.status !== "em_conferencia") throw new Error("Esta Expedição já foi concluída.");

    const { data: linha, error: linhaErro } = await supabase
      .from("escalas")
      .select("id, shipment, planejada, otimizada")
      .eq("importacao_id", expedicao.importacao_id)
      .eq("shipment", data.codigo)
      .maybeSingle();
    if (linhaErro) throw new Error(linhaErro.message);
    if (!linha)
      return { resultado: "inexistente" as const, mensagem: "Shipment fora da relação original." };
    const rota = rotaEfetiva(linha);
    if (rota !== expedicao.rota) {
      return {
        resultado: "outra_rota" as const,
        mensagem: `Este shipment pertence à rota ${rota}.`,
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: divergencia } = await supabaseAdmin
      .from("audit_logs")
      .select("id")
      .eq("acao", "triagem.rota_concluida_ressalva")
      .eq("entidade_id", expedicao.importacao_id)
      .contains("detalhes", {
        rota: expedicao.rota,
        shipment_ids_nao_localizados: [data.codigo],
      } as never)
      .limit(1)
      .maybeSingle();
    const recuperado = !!divergencia;

    const { error: inserirErro } = await supabase.from("expedicao_leituras").insert({
      expedicao_id: expedicao.id,
      escala_id: linha.id,
      shipment: data.codigo,
      operador_id: userId,
      resultado: "ok",
      nao_localizado_no_recebimento: recuperado,
      localizado_posteriormente_na_expedicao: recuperado,
    });
    if (inserirErro) {
      if (inserirErro.code === "23505") {
        return {
          resultado: "duplicado" as const,
          mensagem: "Shipment já conferido nesta Expedição.",
        };
      }
      throw new Error(inserirErro.message);
    }

    const { count: totalConferidos, error: contagemErro } = await supabase
      .from("expedicao_leituras")
      .select("id", { count: "exact", head: true })
      .eq("expedicao_id", expedicao.id)
      .eq("resultado", "ok");
    if (contagemErro) throw new Error(contagemErro.message);
    const conferidos = totalConferidos ?? expedicao.quantidade_conferida + 1;
    const { error: atualizarErro } = await supabase
      .from("expedicoes")
      .update({ quantidade_conferida: conferidos, updated_at: new Date().toISOString() })
      .eq("id", expedicao.id);
    if (atualizarErro) throw new Error(atualizarErro.message);

    await supabaseAdmin.from("audit_logs").insert({
      user_id: userId,
      acao: recuperado ? "expedicao.shipment_recuperado" : "expedicao.shipment_conferido",
      entidade: "expedicao",
      entidade_id: expedicao.id,
      detalhes: {
        shipment: data.codigo,
        rota: expedicao.rota,
        localizado_posteriormente_na_expedicao: recuperado,
      } as never,
    });

    return {
      resultado: "ok" as const,
      mensagem: recuperado
        ? "Pacote não localizado no Recebimento e recuperado na Expedição."
        : "Shipment conferido na Expedição.",
      conferidos,
      previstos: expedicao.quantidade_prevista,
      recuperado,
    };
  });

export const concluirExpedicao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((entrada: unknown) => concluirSchema.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: expedicao, error } = await supabase
      .from("expedicoes")
      .select("quantidade_prevista, quantidade_conferida")
      .eq("id", data.expedicaoId)
      .single();
    if (error) throw new Error(error.message);
    const faltantes = Math.max(expedicao.quantidade_prevista - expedicao.quantidade_conferida, 0);
    if (faltantes > 0 && !data.confirmarComFaltantes) {
      throw new Error(`Ainda existem ${faltantes} shipment(s) não conferidos.`);
    }
    const status = faltantes === 0 ? "concluida" : "concluida_com_ressalva";
    const { error: atualizarErro } = await supabase
      .from("expedicoes")
      .update({
        status,
        responsavel_meli_svc: data.responsavelMeliSvc || null,
        outro_responsavel: data.outroResponsavel || null,
        observacao: data.observacao || null,
        concluida_por: userId,
        concluida_em: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.expedicaoId);
    if (atualizarErro) throw new Error(atualizarErro.message);
    return { status, faltantes };
  });

/**
 * Materializa a fotografia do fechamento diário sem apagar as divergências.
 * Pode ser chamada novamente antes do envio; após o envio, a evidência deve
 * permanecer imutável e uma nova tentativa deve ser tratada pelo módulo de e-mail.
 */
export const reconciliarFechamentoOperacional = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((entrada: unknown) => baseDiaSchema.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: importacao, error: importacaoErro } = await supabase
      .from("importacoes_escala")
      .select("id")
      .eq("base_id", data.baseId)
      .eq("data_operacional", data.dataOperacional)
      .eq("ativa", true)
      .maybeSingle();
    if (importacaoErro) throw new Error(importacaoErro.message);
    if (!importacao) throw new Error("Não existe importação ativa para este fechamento.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: divergencias, error: divergenciasErro } = await supabaseAdmin
      .from("audit_logs")
      .select("detalhes")
      .eq("acao", "triagem.rota_concluida_ressalva")
      .eq("entidade_id", importacao.id);
    if (divergenciasErro) throw new Error(divergenciasErro.message);

    const faltantesRecebimento = Array.from(
      new Set(
        (divergencias ?? []).flatMap((registro) => {
          const detalhes = registro.detalhes as Record<string, unknown> | null;
          return Array.isArray(detalhes?.shipment_ids_nao_localizados)
            ? detalhes.shipment_ids_nao_localizados.map(String)
            : [];
        }),
      ),
    ).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));

    const { data: expedicoes, error: expedicoesErro } = await supabase
      .from("expedicoes")
      .select("id")
      .eq("base_id", data.baseId)
      .eq("data_operacional", data.dataOperacional);
    if (expedicoesErro) throw new Error(expedicoesErro.message);

    let recuperados: string[] = [];
    const expedicaoIds = (expedicoes ?? []).map((item) => item.id);
    if (expedicaoIds.length) {
      const { data: leituras, error: leiturasErro } = await supabase
        .from("expedicao_leituras")
        .select("shipment")
        .in("expedicao_id", expedicaoIds)
        .eq("localizado_posteriormente_na_expedicao", true);
      if (leiturasErro) throw new Error(leiturasErro.message);
      recuperados = Array.from(new Set((leituras ?? []).map((item) => item.shipment)));
    }

    const recuperadosSet = new Set(recuperados);
    const shipmentIdsFinais = faltantesRecebimento.filter(
      (shipment) => !recuperadosSet.has(shipment),
    );
    const { data: existente, error: existenteErro } = await supabase
      .from("fechamentos_operacionais")
      .select("id, status")
      .eq("base_id", data.baseId)
      .eq("data_operacional", data.dataOperacional)
      .maybeSingle();
    if (existenteErro) throw new Error(existenteErro.message);
    if (existente?.status === "enviado") {
      throw new Error("Este fechamento já foi enviado e sua evidência não pode ser recalculada.");
    }

    const fotografia = {
      faltantes_recebimento: faltantesRecebimento.length,
      recuperados_expedicao: recuperados.length,
      faltantes_finais: shipmentIdsFinais.length,
      shipment_ids_finais: shipmentIdsFinais,
      status: "reconciliado",
      updated_at: new Date().toISOString(),
    };
    const operacao = existente
      ? supabase.from("fechamentos_operacionais").update(fotografia).eq("id", existente.id)
      : supabase.from("fechamentos_operacionais").insert({
          ...fotografia,
          base_id: data.baseId,
          data_operacional: data.dataOperacional,
          criado_por: userId,
        });
    const { error: salvarErro } = await operacao;
    if (salvarErro) throw new Error(salvarErro.message);

    return {
      faltantesRecebimento,
      recuperados,
      shipmentIdsFinais,
    };
  });
