import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CLIENT_ID = "4330561201844861";
const REDIRECT_URI = "https://jmroutes.app/api/meli/oauth/callback";

async function exigirAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error || !data) throw new Error("Apenas administradores podem configurar a integração Meli.");
}

export const meliApiStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigirAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await (supabaseAdmin as any)
      .from("meli_api_conexoes")
      .select("meli_user_id,apelido,token_expira_em,atualizado_em,ativo")
      .eq("ativo", true)
      .order("atualizado_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    return {
      configurado: Boolean(process.env.MELI_CLIENT_SECRET && process.env.MELI_TOKEN_ENCRYPTION_KEY),
      conectado: Boolean(data),
      conta: data ?? null,
      clientId: CLIENT_ID,
    };
  });

export const meliApiIniciarOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigirAdmin(context.supabase, context.userId);
    if (!process.env.MELI_CLIENT_SECRET || !process.env.MELI_TOKEN_ENCRYPTION_KEY) {
      throw new Error("Os segredos da API Meli ainda não foram configurados no servidor.");
    }
    const { randomBase64Url, sha256Base64Url } = await import("@/lib/meli-oauth-crypto.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const state = randomBase64Url(32);
    const verifier = randomBase64Url(64);
    const stateHash = await sha256Base64Url(state);
    const challenge = await sha256Base64Url(verifier);
    const { error } = await (supabaseAdmin as any).from("meli_oauth_states").insert({
      state_hash: stateHash,
      code_verifier: verifier,
      solicitado_por: context.userId,
    });
    if (error) throw new Error("Não foi possível iniciar a autorização Meli.");

    const url = new URL("https://auth.mercadolivre.com.br/authorization");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", CLIENT_ID);
    url.searchParams.set("redirect_uri", REDIRECT_URI);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return { url: url.toString() };
  });

export const meliApiTestarConexao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigirAdmin(context.supabase, context.userId);
    const { meliGet } = await import("@/lib/meli-api.server");
    const { data: conta, renovado } = await meliGet("/users/me");
    const { data: preferencias } = await meliGet(`/users/${conta.id}/shipping_preferences`);
    return {
      ok: true,
      conta: conta.nickname ?? String(conta.id),
      site: conta.site_id ?? null,
      modalidades: Array.isArray(preferencias?.modes) ? preferencias.modes : [],
      renovado,
    };
  });
