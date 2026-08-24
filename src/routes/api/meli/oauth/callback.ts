import { createFileRoute } from "@tanstack/react-router";

const CLIENT_ID = "4330561201844861";
const REDIRECT_URI = "https://jmroutes.app/api/meli/oauth/callback";

function redirect(status: string) {
  return new Response(null, { status: 302, headers: { Location: `/configuracoes?meli=${encodeURIComponent(status)}` } });
}

export const Route = createFileRoute("/api/meli/oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state || url.searchParams.get("error")) return redirect("negado");

        try {
          const secret = process.env.MELI_CLIENT_SECRET;
          if (!secret || !process.env.MELI_TOKEN_ENCRYPTION_KEY) return redirect("configuracao");
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { sha256Base64Url, encryptSecret } = await import("@/lib/meli-oauth-crypto.server");
          const stateHash = await sha256Base64Url(state);
          const { data: pending } = await (supabaseAdmin as any)
            .from("meli_oauth_states")
            .select("state_hash,code_verifier,solicitado_por,expira_em,usado_em")
            .eq("state_hash", stateHash)
            .maybeSingle();
          if (!pending || pending.usado_em || new Date(pending.expira_em).getTime() < Date.now()) return redirect("state_invalido");

          const tokenResponse = await fetch("https://api.mercadolibre.com/oauth/token", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "authorization_code",
              client_id: CLIENT_ID,
              client_secret: secret,
              code,
              redirect_uri: REDIRECT_URI,
              code_verifier: pending.code_verifier,
            }),
          });
          if (!tokenResponse.ok) return redirect("token_erro");
          const tokens = await tokenResponse.json() as {
            access_token?: string; refresh_token?: string; expires_in?: number; user_id?: number; scope?: string;
          };
          if (!tokens.access_token || !tokens.refresh_token || !tokens.user_id) return redirect("token_invalido");

          const meResponse = await fetch("https://api.mercadolibre.com/users/me", {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          });
          const me = meResponse.ok ? await meResponse.json() as { nickname?: string } : {};
          const { error: saveError } = await (supabaseAdmin as any).from("meli_api_conexoes").upsert({
            meli_user_id: tokens.user_id,
            apelido: me.nickname ?? null,
            access_token_criptografado: await encryptSecret(tokens.access_token),
            refresh_token_criptografado: await encryptSecret(tokens.refresh_token),
            token_expira_em: new Date(Date.now() + Math.max(60, tokens.expires_in ?? 21600) * 1000).toISOString(),
            scopes: (tokens.scope ?? "").split(" ").filter(Boolean),
            conectado_por: pending.solicitado_por,
            atualizado_em: new Date().toISOString(),
            ativo: true,
          }, { onConflict: "meli_user_id" });
          if (saveError) return redirect("salvar_erro");
          await (supabaseAdmin as any).from("meli_oauth_states").update({ usado_em: new Date().toISOString() }).eq("state_hash", stateHash);
          return redirect("conectado");
        } catch (error) {
          console.error("[meli-oauth-callback]", error);
          return redirect("erro");
        }
      },
    },
  },
});
