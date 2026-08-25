import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptSecret, encryptSecret } from "@/lib/meli-oauth-crypto.server";

const CLIENT_ID = "4330561201844861";
const TOKEN_URL = "https://api.mercadolibre.com/oauth/token";

type Conexao = {
  id: string;
  meli_user_id: number;
  access_token_criptografado: string;
  refresh_token_criptografado: string;
  token_expira_em: string;
  atualizado_em: string;
};

async function conexaoAtiva(): Promise<Conexao> {
  const { data, error } = await (supabaseAdmin as any)
    .from("meli_api_conexoes")
    .select("id,meli_user_id,access_token_criptografado,refresh_token_criptografado,token_expira_em,atualizado_em")
    .eq("ativo", true)
    .order("atualizado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) throw new Error("A conta do Mercado Livre não está conectada.");
  return data as Conexao;
}

export async function obterMeliAccessToken(forcarRenovacao = false): Promise<{ accessToken: string; userId: number; renovado: boolean }> {
  const atual = await conexaoAtiva();
  if (!forcarRenovacao && new Date(atual.token_expira_em).getTime() > Date.now() + 5 * 60_000) {
    return { accessToken: await decryptSecret(atual.access_token_criptografado), userId: atual.meli_user_id, renovado: false };
  }

  const secret = process.env.MELI_CLIENT_SECRET;
  if (!secret) throw new Error("MELI_CLIENT_SECRET não configurado.");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      client_secret: secret,
      refresh_token: await decryptSecret(atual.refresh_token_criptografado),
    }),
  });

  if (!response.ok) {
    // Outro pedido pode ter renovado primeiro, pois o refresh token é de uso único.
    const recente = await conexaoAtiva();
    if (recente.atualizado_em !== atual.atualizado_em && new Date(recente.token_expira_em).getTime() > Date.now()) {
      return { accessToken: await decryptSecret(recente.access_token_criptografado), userId: recente.meli_user_id, renovado: false };
    }
    throw new Error("Não foi possível renovar a autorização do Mercado Livre.");
  }

  const token = await response.json() as {
    access_token?: string; refresh_token?: string; expires_in?: number; user_id?: number; scope?: string;
  };
  if (!token.access_token || !token.refresh_token) throw new Error("Resposta de renovação inválida do Mercado Livre.");
  const atualizadoEm = new Date().toISOString();
  const { data: saved, error } = await (supabaseAdmin as any)
    .from("meli_api_conexoes")
    .update({
      access_token_criptografado: await encryptSecret(token.access_token),
      refresh_token_criptografado: await encryptSecret(token.refresh_token),
      token_expira_em: new Date(Date.now() + Math.max(60, token.expires_in ?? 21600) * 1000).toISOString(),
      scopes: (token.scope ?? "").split(" ").filter(Boolean),
      atualizado_em: atualizadoEm,
    })
    .eq("id", atual.id)
    .eq("atualizado_em", atual.atualizado_em)
    .select("id")
    .maybeSingle();
  if (error || !saved) throw new Error("A autorização foi renovada, mas não pôde ser salva.");
  return { accessToken: token.access_token, userId: token.user_id ?? atual.meli_user_id, renovado: true };
}

export async function meliGet(path: string): Promise<{ data: any; renovado: boolean }> {
  let auth = await obterMeliAccessToken();
  const request = (accessToken: string) => fetch(`https://api.mercadolibre.com${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, "x-format-new": "true" },
  });

  let response = await request(auth.accessToken);

  // O Meli pode invalidar um access token antes do horário informado. Nesse caso,
  // renova uma única vez e repete a consulta, sem criar um ciclo de tentativas.
  if (response.status === 401) {
    try {
      auth = await obterMeliAccessToken(true);
    } catch {
      throw new Error("A autorização do Mercado Livre expirou ou foi revogada. Reconecte a conta.");
    }
    response = await request(auth.accessToken);
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("A conta conectada não está autorizada a acessar esse shipment. Confirme se o envio pertence à conta DALLANRICARDO2008.");
    }
    if (response.status === 403) {
      throw new Error("A conta conectada não tem permissão para acessar esse shipment.");
    }
    if (response.status === 404) {
      throw new Error("Shipment não encontrado ou não disponível para a conta conectada.");
    }
    throw new Error(`A API do Mercado Livre respondeu ${response.status}.`);
  }
  return { data: await response.json(), renovado: auth.renovado };
}
