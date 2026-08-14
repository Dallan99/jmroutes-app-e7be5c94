import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

// Minimal typed shim for the Supabase Auth OAuth (beta) namespace used only here.
type OAuthDetails = {
  client?: { name?: string | null; client_uri?: string | null } | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
};
type OAuthResult = { data: OAuthDetails | null; error: { message: string } | null };
type OAuthNamespace = {
  getAuthorizationDetails: (id: string) => Promise<OAuthResult>;
  approveAuthorization: (id: string) => Promise<OAuthResult>;
  denyAuthorization: (id: string) => Promise<OAuthResult>;
};
function getOauthNs(): OAuthNamespace {
  const anySb = supabase as unknown as { auth: { oauth: OAuthNamespace } };
  return anySb.auth.oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/auth", search: { next } as never });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await getOauthNs().getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate } as never);
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="min-h-screen flex items-center justify-center p-6">
      <Card className="p-6 max-w-md">
        <h1 className="font-semibold">Não foi possível carregar esta autorização</h1>
        <p className="text-sm text-muted-foreground mt-2">
          {String((error as Error)?.message ?? error)}
        </p>
      </Card>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error } = approve
      ? await getOauthNs().approveAuthorization(authorization_id)
      : await getOauthNs().denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("O servidor de autorização não retornou uma URL de redirecionamento.");
      return;
    }
    window.location.href = target;
  }

  const clientName = details?.client?.name ?? "um cliente externo";

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-muted/30">
      <Card className="p-6 max-w-md w-full space-y-4">
        <div>
          <h1 className="font-display text-xl font-bold">Conectar {clientName} ao JMRoutes</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Ao aprovar, {clientName} poderá chamar as ferramentas MCP do JMRoutes agindo como você,
            respeitando suas permissões (base, papel) e as políticas de RLS.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-2 justify-end">
          <Button variant="outline" disabled={busy} onClick={() => decide(false)}>
            Negar
          </Button>
          <Button disabled={busy} onClick={() => decide(true)}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Aprovar
          </Button>
        </div>
      </Card>
    </main>
  );
}
