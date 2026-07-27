import { auth, defineMcp } from "@lovable.dev/mcp-js";
import meuPerfil from "./tools/meu-perfil";
import listarBases from "./tools/listar-bases";
import resumoOperacional from "./tools/resumo-operacional";

// The OAuth issuer must be the direct Supabase host, not the .lovable.cloud proxy.
// import.meta.env.VITE_SUPABASE_PROJECT_ID is inlined by Vite at build time.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "jmroutes-mcp",
  title: "JMRoutes MCP",
  version: "0.1.0",
  instructions:
    "Ferramentas de leitura do JMRoutes (recebimento, triagem, devoluções, transferências, integração Meli). Todas as chamadas respeitam RLS e agem como o usuário autenticado.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [meuPerfil, listarBases, resumoOperacional],
});
