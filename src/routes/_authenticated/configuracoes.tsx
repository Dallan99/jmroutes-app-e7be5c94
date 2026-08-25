import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { meliApiIniciarOAuth, meliApiStatus, meliApiTestarConexao, meliApiTestarShipment } from "@/lib/meli-oauth.functions";
import { Link2, Loader2, PackageSearch, Settings } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({ meta: [{ title: "Configurações — JM Transportes" }] }),
  component: ConfiguracoesPage,
});

function ConfiguracoesPage() {
  const statusFn = useServerFn(meliApiStatus);
  const conectarFn = useServerFn(meliApiIniciarOAuth);
  const testarFn = useServerFn(meliApiTestarConexao);
  const testarShipmentFn = useServerFn(meliApiTestarShipment);
  const [shipmentId, setShipmentId] = useState("");
  const [testandoShipment, setTestandoShipment] = useState(false);
  const [shipmentResultado, setShipmentResultado] = useState<Awaited<ReturnType<typeof testarShipmentFn>> | null>(null);
  const status = useQuery({ queryKey: ["meli-api-status"], queryFn: () => statusFn(), staleTime: 30_000 });

  async function conectar() {
    try {
      const { url } = await conectarFn();
      window.location.assign(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível iniciar a conexão.");
    }
  }

  async function testar() {
    try {
      const resultado = await testarFn();
      toast.success(`API conectada: ${resultado.conta}${resultado.modalidades.length ? ` (${resultado.modalidades.join(", ")})` : ""}`);
      await status.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível testar a API.");
    }
  }

  async function testarShipment() {
    const id = shipmentId.replace(/\D/g, "");
    if (!id) return toast.warning("Digite ou bipe um shipment ID.");
    setTestandoShipment(true);
    setShipmentResultado(null);
    try {
      const resultado = await testarShipmentFn({ data: { shipmentId: id } });
      setShipmentResultado(resultado);
      if (resultado.ok) {
        toast.success(`Shipment ${resultado.shipment.id} acessível pela API oficial.`);
      } else {
        toast.warning(resultado.mensagem);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "A API não liberou esse shipment para a conta conectada.");
    } finally {
      setTestandoShipment(false);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Parâmetros gerais do sistema, políticas de sessão e preferências operacionais.
        </p>
      </div>
      <Card className="p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex gap-3">
            <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center">
              <Link2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <div className="font-semibold">API oficial do Mercado Livre</div>
              <p className="text-sm text-muted-foreground">Shipments e eventos Flex da conta empresarial.</p>
            </div>
          </div>
          <Badge variant={status.data?.conectado ? "default" : "outline"}>
            {status.data?.conectado ? "Conectado" : status.data?.configurado ? "Aguardando autorização" : "Aguardando segredo do servidor"}
          </Badge>
        </div>
        {status.data?.conta && (
          <div className="rounded-lg bg-muted/50 p-3 text-sm">
            Conta: <b>{status.data.conta.apelido ?? status.data.conta.meli_user_id}</b>
          </div>
        )}
        <div>
          <Button onClick={conectar} disabled={status.isLoading || !status.data?.configurado}>
            {status.isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {status.data?.conectado ? "Reconectar Mercado Livre" : "Conectar Mercado Livre"}
          </Button>
          {status.data?.conectado && (
            <Button className="ml-2" variant="outline" onClick={testar}>Testar API oficial</Button>
          )}
        </div>

        {status.data?.conectado && (
          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center gap-2">
              <PackageSearch className="h-4 w-4 text-primary" />
              <div>
                <div className="text-sm font-semibold">Validar acesso a um envio</div>
                <p className="text-xs text-muted-foreground">Bipe um shipment real para confirmar se a conta conectada libera os dados operacionais.</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="meli-shipment-teste">Shipment ID</Label>
                <Input
                  id="meli-shipment-teste"
                  inputMode="numeric"
                  value={shipmentId}
                  onChange={(event) => setShipmentId(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void testarShipment();
                    }
                  }}
                  placeholder="Bipe ou digite o ID do shipment"
                />
              </div>
              <Button variant="outline" onClick={testarShipment} disabled={testandoShipment}>
                {testandoShipment && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Validar shipment
              </Button>
            </div>
            {shipmentResultado && (
              shipmentResultado.ok ? (
                <div className="grid gap-2 rounded-lg border bg-muted/50 p-3 text-sm sm:grid-cols-3">
                  <div><span className="text-muted-foreground">ID</span><br /><b>{shipmentResultado.shipment.id}</b></div>
                  <div><span className="text-muted-foreground">Status</span><br /><b>{shipmentResultado.shipment.status ?? "—"}</b></div>
                  <div><span className="text-muted-foreground">Logística</span><br /><b>{shipmentResultado.shipment.logisticType ?? shipmentResultado.shipment.mode ?? "—"}</b></div>
                </div>
              ) : (
                <div className="rounded-lg border bg-muted/50 p-3 text-sm">
                  <div className="font-medium">Shipment não acessível</div>
                  <p className="mt-1 text-muted-foreground">{shipmentResultado.mensagem}</p>
                </div>
              )
            )}
          </div>
        )}
      </Card>

      <Card className="p-10 flex flex-col items-center justify-center text-center gap-3 border-dashed">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Settings className="w-6 h-6 text-primary" />
        </div>
        <div className="space-y-1">
          <div className="font-medium">Módulo em construção</div>
          <p className="text-sm text-muted-foreground max-w-md">
            Em breve: tempo de inatividade, política de senhas, notificações e preferências por base.
          </p>
        </div>
      </Card>
    </div>
  );
}
