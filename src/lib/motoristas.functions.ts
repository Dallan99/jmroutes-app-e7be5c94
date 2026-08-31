import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error || !data) throw new Error("Acesso negado: apenas administradores.");
}

export type MotoristaCadastro = {
  id: string;
  nome: string;
  placa: string;
  meliDriverId: string;
  meliNome: string | null;
  ativo: boolean;
  createdAt: string;
};

export const listarMotoristasCadastrados = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MotoristaCadastro[]> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: motoristas, error }, { data: catalogo }] = await Promise.all([
      supabaseAdmin
        .from("motoristas")
        .select("id, nome, placa, meli_driver_id, ativo, created_at")
        .not("meli_driver_id", "is", null)
        .order("nome"),
      supabaseAdmin.from("meli_motoristas_catalogo").select("meli_driver_id, nome"),
    ]);
    if (error) throw new Error(error.message);
    const nomes = new Map((catalogo ?? []).map((m) => [m.meli_driver_id, m.nome]));
    return (motoristas ?? []).map((m) => ({
      id: m.id,
      nome: m.nome,
      placa: m.placa ?? "",
      meliDriverId: m.meli_driver_id ?? "",
      meliNome: m.meli_driver_id ? nomes.get(m.meli_driver_id) ?? null : null,
      ativo: m.ativo,
      createdAt: m.created_at,
    }));
  });

const motoristaSchema = z.object({
  id: z.string().uuid().optional(),
  nome: z.string().trim().min(2).max(120),
  placa: z.string().trim().regex(/^[A-Z0-9]{7}$/, "Informe uma placa válida com 7 caracteres."),
  meliDriverId: z.string().trim().min(1).max(80),
});

export const salvarMotoristaCadastrado = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((entrada: unknown) => motoristaSchema.parse(entrada))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: identidade, error: identidadeErro } = await supabaseAdmin
      .from("meli_motoristas_catalogo")
      .select("meli_driver_id, status")
      .eq("meli_driver_id", data.meliDriverId)
      .single();
    if (identidadeErro || !identidade) throw new Error("Motorista Meli não encontrado no catálogo.");
    if (identidade.status !== "active") throw new Error("Este motorista está pausado ou bloqueado no Meli.");

    let motoristaId = data.id;
    let antigoMeliId: string | null = null;
    if (data.id) {
      const { data: atual } = await supabaseAdmin
        .from("motoristas")
        .select("meli_driver_id")
        .eq("id", data.id)
        .single();
      antigoMeliId = atual?.meli_driver_id ?? null;
      const { error } = await supabaseAdmin
        .from("motoristas")
        .update({ nome: data.nome, placa: data.placa, meli_driver_id: data.meliDriverId })
        .eq("id", data.id);
      if (error?.code === "23505") throw new Error("Este motorista Meli já está vinculado a outro cadastro.");
      if (error) throw new Error(error.message);
    } else {
      const { data: criado, error } = await supabaseAdmin
        .from("motoristas")
        .insert({ nome: data.nome, placa: data.placa, meli_driver_id: data.meliDriverId, ativo: true })
        .select("id")
        .single();
      if (error?.code === "23505") throw new Error("Este motorista Meli já está vinculado a outro cadastro.");
      if (error) throw new Error(error.message);
      motoristaId = criado.id;
    }

    if (antigoMeliId && antigoMeliId !== data.meliDriverId) {
      await supabaseAdmin.from("meli_rotas").update({ motorista_id: null }).eq("motorista_id", motoristaId!);
    }
    await supabaseAdmin
      .from("meli_rotas")
      .update({ motorista_id: motoristaId! })
      .eq("driver_id", data.meliDriverId);

    await supabaseAdmin.from("audit_logs").insert({
      user_id: context.userId,
      acao: data.id ? "motorista.alterado" : "motorista.criado",
      entidade: "motorista",
      entidade_id: motoristaId!,
      detalhes: { nome: data.nome, placa: data.placa, meli_driver_id: data.meliDriverId },
    });
    return { id: motoristaId! };
  });

const ativoSchema = z.object({ id: z.string().uuid(), ativo: z.boolean() });

export const definirMotoristaAtivo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((entrada: unknown) => ativoSchema.parse(entrada))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: motorista, error } = await supabaseAdmin
      .from("motoristas")
      .update({ ativo: data.ativo })
      .eq("id", data.id)
      .select("meli_driver_id")
      .single();
    if (error) throw new Error(error.message);
    if (motorista.meli_driver_id) {
      await supabaseAdmin
        .from("meli_rotas")
        .update({ motorista_id: data.ativo ? data.id : null })
        .eq("driver_id", motorista.meli_driver_id);
    }
    return { ok: true };
  });
