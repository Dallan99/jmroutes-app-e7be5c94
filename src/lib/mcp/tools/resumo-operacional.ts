import { defineTool } from "@lovable.dev/mcp-js";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";

export default defineTool({
  name: "resumo_operacional",
  title: "Resumo operacional do dia",
  description:
    "Retorna um resumo do dia operacional para as bases visíveis ao usuário: total de rotas na escala, recebidos, triados, devoluções e transferências. Se `dia` for omitido, usa a data atual.",
  inputSchema: {
    dia: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato esperado: YYYY-MM-DD")
      .optional()
      .describe("Dia operacional no formato YYYY-MM-DD (opcional; padrão: hoje)."),
    base_codigo: z
      .string()
      .optional()
      .describe("Código da base (ex.: ESP16). Opcional; se omitido, retorna todas as bases visíveis."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ dia, base_codigo }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado." }], isError: true };
    }
    const sb = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
      global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const diaOp = dia ?? new Date().toISOString().slice(0, 10);

    let basesQuery = sb.from("bases").select("id, codigo, nome").order("codigo", { ascending: true });
    if (base_codigo) basesQuery = basesQuery.eq("codigo", base_codigo.toUpperCase());
    const { data: bases, error: basesErr } = await basesQuery;
    if (basesErr) return { content: [{ type: "text", text: basesErr.message }], isError: true };
    if (!bases?.length) {
      return {
        content: [{ type: "text", text: "Nenhuma base visível para o usuário." }],
        structuredContent: { dia: diaOp, bases: [] },
      };
    }

    const baseIds = bases.map((b) => b.id);
    const [rotas, recebidos, triados, devolucoes, transferencias] = await Promise.all([
      sb.from("escala_rotas").select("id, base_id", { count: "exact", head: true }).in("base_id", baseIds).eq("dia_operacional", diaOp),
      sb.from("recebimentos").select("id, base_id", { count: "exact", head: true }).in("base_id", baseIds).eq("dia_operacional", diaOp),
      sb.from("triagem_itens").select("id, base_id", { count: "exact", head: true }).in("base_id", baseIds).eq("dia_operacional", diaOp),
      sb.from("devolucoes").select("id, base_id", { count: "exact", head: true }).in("base_id", baseIds).eq("dia_operacional", diaOp),
      sb.from("transferencias").select("id, base_origem_id", { count: "exact", head: true }).in("base_origem_id", baseIds).eq("dia_operacional", diaOp),
    ]);

    const resumo = {
      dia_operacional: diaOp,
      bases: bases.map((b) => ({ codigo: b.codigo, nome: b.nome })),
      totais: {
        rotas_escala: rotas.count ?? null,
        recebimentos: recebidos.count ?? null,
        triagens: triados.count ?? null,
        devolucoes: devolucoes.count ?? null,
        transferencias: transferencias.count ?? null,
      },
      observacao:
        "Totais agregados sobre as bases visíveis (filtro por base opcional). Alguns módulos podem usar tabelas específicas; para detalhamento use a UI ou peça uma tool dedicada.",
    };

    return {
      content: [{ type: "text", text: JSON.stringify(resumo, null, 2) }],
      structuredContent: resumo,
    };
  },
});
