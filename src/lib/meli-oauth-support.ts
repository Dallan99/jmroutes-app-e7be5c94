import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const MELI_CLIENT_ID = "4330561201844861";
export const MELI_REDIRECT_URI = "https://jmroutes.app/api/meli/oauth/callback";

export const validarShipmentTesteInput = z.object({
  shipmentId: z
    .string()
    .trim()
    .regex(/^\d{5,30}$/, "Informe um shipment ID válido."),
});

export async function exigirAdmin(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();

  if (error || !data) {
    throw new Error("Apenas administradores podem configurar a integração Meli.");
  }
}

const MENSAGENS_SEGURAS = [
  "A conta conectada não está autorizada",
  "A conta conectada não tem permissão",
  "Shipment não encontrado",
  "A API do Mercado Livre respondeu",
  "A autorização do Mercado Livre expirou",
  "A conta do Mercado Livre não está conectada",
] as const;

/** Evita devolver detalhes internos, tokens ou respostas brutas ao navegador. */
export function erroControladoTesteShipment(error: unknown): Error {
  const mensagem = error instanceof Error ? error.message : "";
  if (MENSAGENS_SEGURAS.some((inicio) => mensagem.startsWith(inicio))) {
    return new Error(mensagem);
  }
  return new Error("Não foi possível consultar o shipment no Mercado Livre.");
}
