// Fase 2 — Recebimento físico de pacotes vindos da Integração Meli.
//
// Pacotes importados do Meli são publicados como carga esperada em `escalas`
// (coluna `meli_pacote_id` preenchida). Este helper permite que a tela de
// Recebimento marque esses pacotes como fisicamente recebidos, sem alterar o
// fluxo antigo de `rotas`/`volumes`: ele só é acionado quando o código bipado
// NÃO existe em `volumes`.
import type { SupabaseClient } from "@supabase/supabase-js";

export type RecebimentoEscalaResultado =
  | "ok"
  | "duplicado"
  | "encerrada"
  | "outra_base";

export type RecebimentoEscalaResposta = {
  resultado: RecebimentoEscalaResultado;
  mensagem: string;
  escalaId: string;
  baseId: string | null;
  rotaCodigo: string;
  previstos: number;
  recebidos: number;
};

type Cliente = SupabaseClient<never>;

function rotaEfetiva(e: { otimizada: string | null; planejada: string | null }) {
  return e.otimizada?.trim() || e.planejada?.trim() || "—";
}

export async function receberEscalaMeli(
  supabase: Cliente,
  params: {
    codigo: string;
    baseId: string;
    dataOperacional: string;
    userId: string;
    hora: string;
  },
): Promise<RecebimentoEscalaResposta | null> {
  const db = supabase as unknown as {
    from: (t: string) => any;
  };

  const { data: importacao } = await db
    .from("importacoes_escala")
    .select("id")
    .eq("base_id", params.baseId)
    .eq("data_operacional", params.dataOperacional)
    .eq("ativa", true)
    .maybeSingle();

  if (!importacao) return null;

  const { data: escala } = await db
    .from("escalas")
    .select(
      "id, shipment, planejada, otimizada, base_id, recebido, meli_pacote_id",
    )
    .eq("importacao_id", importacao.id)
    .eq("shipment", params.codigo)
    .not("meli_pacote_id", "is", null)
    .maybeSingle();

  if (!escala) return null;

  const rotaCodigo = rotaEfetiva(escala);

  const contar = async () => {
    const base = () =>
      db
        .from("escalas")
        .select("id", { count: "exact", head: true })
        .eq("importacao_id", importacao.id)
        .not("meli_pacote_id", "is", null)
        .eq(escala.otimizada?.trim() ? "otimizada" : "planejada", rotaCodigo);
    const [{ count: previstos }, { count: recebidos }] = await Promise.all([
      base(),
      base().eq("recebido", true),
    ]);
    return { previstos: previstos ?? 0, recebidos: recebidos ?? 0 };
  };

  if (escala.recebido) {
    const { previstos, recebidos } = await contar();
    return {
      resultado: "duplicado",
      mensagem: `Pacote ${escala.shipment} já foi recebido nesta rota.`,
      escalaId: escala.id,
      baseId: escala.base_id,
      rotaCodigo,
      previstos,
      recebidos,
    };
  }

  const { data: atualizado } = await db
    .from("escalas")
    .update({
      recebido: true,
      recebido_em: params.hora,
      recebido_por: params.userId,
    })
    .eq("id", escala.id)
    .eq("recebido", false)
    .select("id")
    .maybeSingle();

  const { previstos, recebidos } = await contar();

  if (!atualizado) {
    return {
      resultado: "duplicado",
      mensagem: `Pacote ${escala.shipment} já foi recebido nesta rota.`,
      escalaId: escala.id,
      baseId: escala.base_id,
      rotaCodigo,
      previstos,
      recebidos,
    };
  }

  return {
    resultado: "ok",
    mensagem:
      recebidos >= previstos
        ? `Recebimento COMPLETO da rota ${rotaCodigo}.`
        : `Pacote recebido — rota ${rotaCodigo} (${recebidos}/${previstos}).`,
    escalaId: escala.id,
    baseId: escala.base_id,
    rotaCodigo,
    previstos,
    recebidos,
  };
}
