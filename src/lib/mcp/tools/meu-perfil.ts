import { defineTool } from "@lovable.dev/mcp-js";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function supabaseForUser(token: string) {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "meu_perfil",
  title: "Meu perfil",
  description: "Retorna o perfil, papéis (admin/supervisor/gerente/operador) e bases permitidas do usuário autenticado no JMRoutes.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado." }], isError: true };
    }
    const sb = supabaseForUser(ctx.getToken()!);
    const userId = ctx.getUserId()!;
    const [{ data: profile }, { data: roles }, { data: userBases }] = await Promise.all([
      sb.from("profiles").select("id, nome, email, base_id, ativo").eq("id", userId).maybeSingle(),
      sb.from("user_roles").select("role").eq("user_id", userId),
      sb.from("user_bases").select("base_id, bases(codigo, nome)").eq("user_id", userId),
    ]);
    const payload = {
      user_id: userId,
      email: ctx.getUserEmail() ?? profile?.email ?? null,
      profile: profile ?? null,
      roles: (roles ?? []).map((r) => r.role),
      bases: (userBases ?? []).map((ub) => ub.bases).filter(Boolean),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  },
});
