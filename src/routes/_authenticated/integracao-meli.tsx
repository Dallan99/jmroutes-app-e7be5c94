import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  meliImportarRota,
  meliListarRotas,
  meliDetalharRota,
  type MeliImportResult,
  type MeliListarResult,
  type MeliDetalheResult,
} from "@/lib/meli.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, PackageSearch, RefreshCcw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/integracao-meli")({
  head: () => ({
    meta: [
      { title: "Integração Meli — JMRoutes" },
      {
        name: "description",
        content:
          "Importação manual de rotas do Meli via JSON e consulta consolidada de pacotes.",
      },
      { property: "og:title", content: "Integração Meli — JMRoutes" },
      {
        property: "og:description",
        content: "Módulo piloto de integração manual com rotas do Meli.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IntegracaoMeliPage,
});

function IntegracaoMeliPage() {
  const router = useRouter();
  const importar = useServerFn(meliImportarRota);
  const listar = useServerFn(meliListarRotas);
  const detalhar = useServerFn(meliDetalharRota);

  const [jsonTexto, setJsonTexto] = useState("");
  const [arquivoNome, setArquivoNome] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const [ultimoResultado, setUltimoResultado] =
    useState<MeliImportResult | null>(null);

  const [busca, setBusca] = useState("");
  const [cluster, setCluster] = useState("");
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const [pagina, setPagina] = useState(0);
  const limite = 20;

  const [rotaAberta, setRotaAberta] = useState<string | null>(null);

  const rotasQuery = useQuery({
    queryKey: ["meli-rotas", { busca, cluster, dataDe, dataAte, pagina }],
    queryFn: () =>
      listar({
        data: {
          busca: busca.trim() || null,
          cluster: cluster.trim() || null,
          data_de: dataDe || null,
          data_ate: dataAte || null,
          limit: limite,
          offset: pagina * limite,
        },
      }) as Promise<MeliListarResult>,
    staleTime: 15_000,
  });

  const detalheQuery = useQuery({
    queryKey: ["meli-detalhe", rotaAberta],
    enabled: !!rotaAberta,
    queryFn: () =>
      detalhar({
        data: { rota_id: rotaAberta!, limit: 500, offset: 0 },
      }) as Promise<MeliDetalheResult>,
  });

  const totalPaginas = useMemo(() => {
    const total = rotasQuery.data?.total ?? 0;
    return Math.max(1, Math.ceil(total / limite));
  }, [rotasQuery.data?.total]);

  async function handleArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setArquivoNome(f.name);
    const txt = await f.text();
    setJsonTexto(txt);
  }

  async function handleImportar() {
    if (!jsonTexto.trim()) {
      toast.error("Cole o JSON ou selecione um arquivo.");
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonTexto);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("JSON deve ser um objeto com 'meli_route_id'.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "JSON inválido.");
      return;
    }
    setImportando(true);
    try {
      const res = await importar({
        data: { payload: parsed, arquivo_nome: arquivoNome },
      });
      setUltimoResultado(res);
      if (res.status === "ok") {
        toast.success(
          `Rota ${res.route_id} importada — ${res.pacotes_inseridos ?? 0} novos, ${res.pacotes_atualizados ?? 0} atualizados.`,
        );
        setJsonTexto("");
        setArquivoNome(null);
        router.invalidate();
        rotasQuery.refetch();
      } else {
        toast.error(`Falha na importação: ${res.erro ?? "erro desconhecido"}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro na importação.");
    } finally {
      setImportando(false);
    }
  }

  const rotas = rotasQuery.data?.rotas ?? [];
  const semPermissao =
    rotasQuery.data?.status === "erro" &&
    rotasQuery.data?.erro === "sem_permissao";

  return (
    <div className="p-6 space-y-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <PackageSearch className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold">Integração Meli</h1>
          <Badge variant="secondary">Piloto</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Importe rotas do Meli manualmente por JSON e consulte pacotes já
          registrados. Somente Admin, Gerente e Supervisor têm acesso.
        </p>
      </header>

      {semPermissao && (
        <Card className="border-destructive">
          <CardContent className="p-4 text-sm text-destructive">
            Você não tem permissão para operar este módulo.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Upload className="h-5 w-5" /> Importar rota (JSON)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="arquivo-meli">Arquivo .json</Label>
              <Input
                id="arquivo-meli"
                type="file"
                accept="application/json,.json"
                onChange={handleArquivo}
              />
              {arquivoNome && (
                <p className="text-xs text-muted-foreground mt-1">
                  {arquivoNome}
                </p>
              )}
            </div>
            <div className="text-xs text-muted-foreground self-end">
              Estrutura esperada: <code>meli_route_id</code>, <code>cluster</code>,{" "}
              <code>facility</code>, <code>data_rota</code> e{" "}
              <code>pacotes[]</code>.
            </div>
          </div>
          <div>
            <Label htmlFor="json-meli">Ou cole o JSON</Label>
            <Textarea
              id="json-meli"
              value={jsonTexto}
              onChange={(e) => setJsonTexto(e.target.value)}
              rows={8}
              placeholder='{"meli_route_id":"...","pacotes":[...]}'
              className="font-mono text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handleImportar} disabled={importando}>
              {importando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Importar
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setJsonTexto("");
                setArquivoNome(null);
                setUltimoResultado(null);
              }}
              disabled={importando}
            >
              Limpar
            </Button>
          </div>

          {ultimoResultado && (
            <div className="rounded border p-3 text-sm bg-muted/40 space-y-1">
              <div className="flex items-center gap-2">
                <strong>Resultado:</strong>
                <Badge
                  variant={
                    ultimoResultado.status === "ok" ? "default" : "destructive"
                  }
                >
                  {ultimoResultado.status}
                </Badge>
                {ultimoResultado.route_id && (
                  <span className="text-xs text-muted-foreground">
                    route_id: {ultimoResultado.route_id}
                  </span>
                )}
              </div>
              {ultimoResultado.status === "ok" ? (
                <ul className="text-xs grid gap-1 sm:grid-cols-2">
                  <li>Recebidos: {ultimoResultado.pacotes_recebidos}</li>
                  <li>Únicos: {ultimoResultado.pacotes_unicos}</li>
                  <li>Inseridos: {ultimoResultado.pacotes_inseridos}</li>
                  <li>Atualizados: {ultimoResultado.pacotes_atualizados}</li>
                  <li>Inalterados: {ultimoResultado.pacotes_inalterados}</li>
                  <li>Inválidos: {ultimoResultado.pacotes_invalidos}</li>
                  <li>
                    Duplicados no payload:{" "}
                    {ultimoResultado.pacotes_duplicados_no_payload}
                  </li>
                  <li>
                    Ordem inválida: {ultimoResultado.pacotes_com_ordem_invalida}
                  </li>
                </ul>
              ) : (
                <p className="text-xs text-destructive">
                  {ultimoResultado.erro}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Rotas importadas</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => rotasQuery.refetch()}
            disabled={rotasQuery.isFetching}
          >
            <RefreshCcw
              className={`h-4 w-4 mr-2 ${rotasQuery.isFetching ? "animate-spin" : ""}`}
            />
            Atualizar
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-4">
            <div>
              <Label htmlFor="f-busca">Busca (route_id/facility)</Label>
              <Input
                id="f-busca"
                value={busca}
                onChange={(e) => {
                  setPagina(0);
                  setBusca(e.target.value);
                }}
              />
            </div>
            <div>
              <Label htmlFor="f-cluster">Cluster</Label>
              <Input
                id="f-cluster"
                value={cluster}
                onChange={(e) => {
                  setPagina(0);
                  setCluster(e.target.value);
                }}
              />
            </div>
            <div>
              <Label htmlFor="f-de">Data de</Label>
              <Input
                id="f-de"
                type="date"
                value={dataDe}
                onChange={(e) => {
                  setPagina(0);
                  setDataDe(e.target.value);
                }}
              />
            </div>
            <div>
              <Label htmlFor="f-ate">Data até</Label>
              <Input
                id="f-ate"
                type="date"
                value={dataAte}
                onChange={(e) => {
                  setPagina(0);
                  setDataAte(e.target.value);
                }}
              />
            </div>
          </div>

          <div className="rounded border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-xs uppercase">
                <tr>
                  <th className="text-left p-2">route_id</th>
                  <th className="text-left p-2">Cluster</th>
                  <th className="text-left p-2">Facility</th>
                  <th className="text-left p-2">Data</th>
                  <th className="text-right p-2">Pacotes</th>
                  <th className="text-right p-2">Impressos</th>
                  <th className="text-left p-2">Última importação</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {rotasQuery.isLoading && (
                  <tr>
                    <td colSpan={8} className="p-4 text-center text-muted-foreground">
                      Carregando…
                    </td>
                  </tr>
                )}
                {!rotasQuery.isLoading && rotas.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-4 text-center text-muted-foreground">
                      Nenhuma rota encontrada.
                    </td>
                  </tr>
                )}
                {rotas.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-muted/40">
                    <td className="p-2 font-mono text-xs">{r.route_id}</td>
                    <td className="p-2">{r.cluster ?? "—"}</td>
                    <td className="p-2">{r.facility ?? "—"}</td>
                    <td className="p-2">{r.data_rota ?? "—"}</td>
                    <td className="p-2 text-right">{r.total_pacotes}</td>
                    <td className="p-2 text-right">{r.total_impressos}</td>
                    <td className="p-2 text-xs">
                      {r.ultima_importacao_em
                        ? new Date(r.ultima_importacao_em).toLocaleString("pt-BR")
                        : "—"}
                    </td>
                    <td className="p-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setRotaAberta(r.id)}
                      >
                        Detalhes
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Total: {rotasQuery.data?.total ?? 0} — Página {pagina + 1}/
              {totalPaginas}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPagina((p) => Math.max(0, p - 1))}
                disabled={pagina === 0}
              >
                Anterior
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setPagina((p) => (p + 1 < totalPaginas ? p + 1 : p))
                }
                disabled={pagina + 1 >= totalPaginas}
              >
                Próxima
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={!!rotaAberta}
        onOpenChange={(open) => !open && setRotaAberta(null)}
      >
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Detalhes da rota{" "}
              <span className="font-mono text-sm">
                {detalheQuery.data?.rota?.route_id}
              </span>
            </DialogTitle>
          </DialogHeader>
          {detalheQuery.isLoading && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Carregando…
            </div>
          )}
          {detalheQuery.data?.status === "ok" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                <Info label="Cluster" value={detalheQuery.data.rota?.cluster} />
                <Info label="Carrier" value={detalheQuery.data.rota?.carrier} />
                <Info label="Facility" value={detalheQuery.data.rota?.facility} />
                <Info label="Data" value={detalheQuery.data.rota?.data_rota} />
                <Info
                  label="Pacotes"
                  value={String(detalheQuery.data.total_pacotes ?? 0)}
                />
                <Info
                  label="Impressos"
                  value={String(detalheQuery.data.rota?.total_impressos ?? 0)}
                />
              </div>
              <div className="rounded border overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60 uppercase">
                    <tr>
                      <th className="text-left p-2">#</th>
                      <th className="text-left p-2">Tracking</th>
                      <th className="text-left p-2">Shipment</th>
                      <th className="text-left p-2">Destinatário</th>
                      <th className="text-left p-2">Endereço</th>
                      <th className="text-left p-2">Cidade/UF</th>
                      <th className="text-left p-2">CEP</th>
                      <th className="text-left p-2">Status</th>
                      <th className="text-left p-2">Etiqueta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detalheQuery.data.pacotes ?? []).map((p) => (
                      <tr key={p.id} className="border-t">
                        <td className="p-2">{p.ordem ?? "—"}</td>
                        <td className="p-2 font-mono">{p.tracking_id}</td>
                        <td className="p-2 font-mono">{p.shipment_id ?? "—"}</td>
                        <td className="p-2">{p.destinatario ?? "—"}</td>
                        <td className="p-2">
                          {[p.endereco, p.bairro].filter(Boolean).join(" — ") ||
                            "—"}
                        </td>
                        <td className="p-2">
                          {[p.cidade, p.uf].filter(Boolean).join("/") || "—"}
                        </td>
                        <td className="p-2">{p.cep ?? "—"}</td>
                        <td className="p-2">{p.status ?? "—"}</td>
                        <td className="p-2">{p.printed_label ?? "—"}</td>
                      </tr>
                    ))}
                    {(detalheQuery.data.pacotes ?? []).length === 0 && (
                      <tr>
                        <td colSpan={9} className="p-4 text-center text-muted-foreground">
                          Sem pacotes.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {detalheQuery.data?.status === "erro" && (
            <p className="text-sm text-destructive">
              {detalheQuery.data.erro}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded border p-2 bg-muted/30">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-sm">{value ?? "—"}</div>
    </div>
  );
}
