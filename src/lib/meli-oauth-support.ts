import { z } from "zod";

export const MELI_CLIENT_ID = "4330561201844861";
export const MELI_REDIRECT_URI = "https://jmroutes.app/api/meli/oauth/callback";

export type ShipmentTesteInput = {
  shipmentId: string;
};

export type ShipmentTesteErro = {
  codigo: "nao_autorizado" | "nao_encontrado" | "erro_api";
  mensagem: string;
};

export async function exigirAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error || !data) throw new Error("Apenas administradores podem configurar a integração Meli.");
}

export function validarShipmentTesteInput(input: unknown): ShipmentTesteInput {
  return z.object({
    shipmentId: z.string().trim().regex(/^\d{5,30}$/, "Informe um shipment ID válido."),
  }).parse(input);
}

export function erroControladoTesteShipment(error: unknown): ShipmentTesteErro | null {
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : null;
  const mensagem = error instanceof Error ? error.message : "A API não liberou esse shipment para a conta conectada.";

  if (status === 401 || status === 403 || mensagem.includes("não autorizada") || mensagem.includes("não tem permissão")) {
    return { codigo: "nao_autorizado", mensagem };
  }

  if (status === 404 || mensagem.includes("não encontrado")) {
    return { codigo: "nao_encontrado", mensagem };
  }

  if (status !== null && status >= 400) {
    return { codigo: "erro_api", mensagem };
  }

  return null;
}