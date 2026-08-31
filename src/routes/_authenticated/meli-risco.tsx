import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { importarRiscoRostering, meliRotasAreaRisco, type ImportacaoRiscoRosteringResultado, type SistemaRiscoRota } from "@/lib/meli-risco.functions";
import { meliDashboardPacotesRota } from "@/lib/meli-dashboard.functions";
import { listarBasesSimples } from "@/lib/bases.functions";
import { classificarRiscoRota } from "@/lib/meli-devolucoes-domain";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, Download, Loader2, RefreshCcw, ShieldAlert, Upload } from "lucide-react";
import { hojeOperacional } from "@/lib/dia-operacional";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/meli-risco")({
  head: () => ({
    meta: [
      { title: "Rotas em Área de Risco — JMRoutes" },
      {
        name: "description",
        content:
          "Visão operacional das rotas e pacotes marcados como área de risco, com detalhamento por rota.",
      },
      { property: "og:title", content: "Rotas em Área de Risco — JMRoutes" },
      {
        property: "og:description",
        content: "Acompanhe rotas integralmente ou parcialmente em área de risco.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),

  component: SistemaRiscoPage,
});

function pct(n: number) {
  return `${Number(n ?? 0).toFixed(1)}%`;
}

function SistemaRiscoPage() {
  const buscarRisco = useServerFn(meliRotasAreaRisco);
  const buscarPacotes = useServerFn(meliDashboardPacotesRota);
  const buscarBases = useServerFn(listarBasesSimples);
  const importarRisco = useServerFn(importarRiscoRostering);

  const [data, setData] = useState<string>(() => hojeOperacional());
  const [baseId, setBaseId] = useState<string>("");
  const [risco, setRisco] = useState<"qualquer" | "integral" | "parcial">("qualquer");
  const [busca, setBusca] = useState("");
  const [rotaAberta, setRotaAberta] = useState<SistemaRiscoRota | null>(null);
  const [resultadoImportacao, setResultadoImportacao] = useState<ImportacaoRiscoRosteringResultado | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const basesQuery = useQuery({
    queryKey: ["bases-simples"],
    queryFn: () => buscarBases(),
    staleTime: 300_000,
  });

  const riscoQuery = useQuery({
    queryKey: ["meli-risco", data, baseId, risco],
    queryFn: () =>
      buscarRisco({
        data: { data, base_id: baseId || null, risco },
      }),
    refetchInterval: 60_000,
  });

  const rotas = useMemo(() => {
    const todas = riscoQuery.data?.rotas ?? [];
    const q = busca.trim().toLowerCase();
    if (!q) return todas;
    return todas.filter((r) =>
      [r.route_id, r.cluster, r.driver_name, r.vehicle_license, r.base_codigo]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [riscoQuery.data, busca]);

  const pacotesQuery = useQuery({
    queryKey: ["meli-risco-pacotes", rotaAberta?.rota_id],
    queryFn: () => buscarPacotes({ data: { rota_id: rotaAberta!.rota_id, limit: 1000 } }),
    enabled: !!rotaAberta,
  });

  const cards = riscoQuery.data?.cards;

  const importarCsv = useMutation({
    mutationFn: async (arquivo: File) => {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await arquivo.arrayBuffer(), { type: "array", raw: false });
      const linhas = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "", raw: false });
      const cabecalho = linhas[0]?.map((v) => String(v).trim()) ?? [];
      const coluna = (nome: string) => cabecalho.indexOf(nome);
      const obrigatorias = ["ID", "Transportadora", "Facility", "Data de início", "Nome Original da Rota Planejada", "É uma Zona de Alto Risco?"];
      if (obrigatorias.some((nome) => coluna(nome) < 0)) throw new Error("O arquivo não possui as colunas esperadas do CSV semanal do AdminML.");
      const brParaIso = (valor: unknown) => {
        const partes = String(valor ?? "").trim().split("/");
        return partes.length === 3 ? `${partes[2]}-${partes[1]}-${partes[0]}` : String(valor ?? "").slice(0, 10);
      };
      const dados = linhas.slice(1).map((l) => ({
        data: brParaIso(l[coluna("Data de início")]),
        facility: String(l[coluna("Facility")] ?? "").trim(),
        cluster: String(l[coluna("Nome Original da Rota Planejada")] ?? "").trim(),
        transportadora: String(l[coluna("Transportadora")] ?? "").trim(),
        altoRisco: String(l[coluna("É uma Zona de Alto Risco?")] ?? "").trim().toLocaleLowerCase("pt-BR") === "sim",
        regiao: String(l[coluna("Região de Entrega da Rota")] ?? "").trim() || null,
        idServico: String(l[coluna("ID")] ?? "").trim() || null,
        classificacao: String(l[coluna("É uma Zona de Alto Risco?")] ?? "").trim(),
      })).filter((l) => l.data && l.facility && l.cluster && (l.classificacao === "Sim" || l.classificacao === "Não"))
        .map(({ classificacao: _classificacao, ...l }) => l);
      if (!dados.length) throw new Error("Nenhuma rota classificada como Sim ou Não foi encontrada no arquivo.");
      return importarRisco({ data: { linhas: dados, arquivoNome: arquivo.name } });
    },
    onSuccess: (resultado) => {
      setResultadoImportacao(resultado);
      toast.success(`${resultado.encontradas} rotas conciliadas com o CSV.`);
      void riscoQuery.refetch();
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  function exportarCsv() {
    const head = [
      "rota",
      "base",
      "motorista",
      "placa",
      "risco",
      "total",
      "pacotes_risco",
      "entregues",
      "pendentes",
      "insucessos",
      "conclusao",
      "motivo",
      "origem",
    ];
    const linhas = rotas.map((r) => [
      r.route_id,
      r.base_codigo ?? "",
      r.driver_name ?? "",
      r.vehicle_license ?? "",
      classificarRiscoRota(r),
      r.total,
      r.pacotes_risco,
      r.entregue_risco,
      r.pendente_risco,
      r.insucesso_risco,
      r.perc_conclusao,
      r.motivo_area_risco ?? "",
      r.origem_area_risco ?? "",
    ]);
    const csv = [head, ...linhas]
      .map((l) => l.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(";"))
      .join("\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `area-risco-${data}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-destructive" />
            Rotas em Área de Risco
          </h1>
          <p className="text-sm text-muted-foreground">
            Classificação atualizada automaticamente pelo Rostering do AdminML. Insucesso, por si
            só, não classifica área de risco.
          </p>

        </div>
        <div className="flex gap-2">
          <input ref={arquivoRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const arquivo = e.target.files?.[0]; if (arquivo) importarCsv.mutate(arquivo); e.currentTarget.value = ""; }} />
          <Button variant="default" size="sm" onClick={() => arquivoRef.current?.click()} disabled={importarCsv.isPending}>
            {importarCsv.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />} Importar CSV (contingência)
          </Button>
          <Button variant="outline" size="sm" onClick={() => riscoQuery.refetch()}>
            <RefreshCcw className="h-4 w-4 mr-2" /> Atualizar
          </Button>
          <Button variant="outline" size="sm" onClick={exportarCsv} disabled={rotas.length === 0}>
            <Download className="h-4 w-4 mr-2" /> CSV
          </Button>
        </div>
      </header>

      {resultadoImportacao && <Card><CardContent className="pt-4 text-sm"><div className="flex flex-wrap gap-x-6 gap-y-1"><span><b>{resultadoImportacao.processadas}</b> classificações lidas</span><span><b>{resultadoImportacao.encontradas}</b> rotas encontradas</span><span><b>{resultadoImportacao.marcadasRisco}</b> em alto risco</span><span><b>{resultadoImportacao.confirmadasSemRisco}</b> sem alto risco</span><span className={resultadoImportacao.naoEncontradas.length ? "text-amber-600" : "text-emerald-600"}><b>{resultadoImportacao.naoEncontradas.length}</b> não encontradas</span></div>{resultadoImportacao.naoEncontradas.length > 0 && <p className="mt-2 text-xs text-muted-foreground">As rotas não encontradas podem ainda não ter sido sincronizadas no JMRoutes. Elas não foram criadas nem alteradas.</p>}</CardContent></Card>}

      <Card>
        <CardContent className="grid gap-3 md:grid-cols-4 pt-4">
          <div className="space-y-1">
            <Label htmlFor="risco-data">Dia</Label>
            <Input id="risco-data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="risco-base">Base</Label>
            <select
              id="risco-base"
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={baseId}
              onChange={(e) => setBaseId(e.target.value)}
            >
              <option value="">Todas as bases</option>
              {(basesQuery.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.codigo} — {b.nome}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="risco-tipo">Tipo de risco</Label>
            <select
              id="risco-tipo"
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={risco}
              onChange={(e) => setRisco(e.target.value as typeof risco)}
            >
              <option value="qualquer">Qualquer risco</option>
              <option value="integral">Rota integral</option>
              <option value="parcial">Parcial (pacotes)</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="risco-busca">Buscar</Label>
            <Input
              id="risco-busca"
              placeholder="Rota, motorista, placa..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
        {[
          { l: "Rotas em risco", v: cards?.rotas ?? 0 },
          { l: "Integrais", v: cards?.rotas_integrais ?? 0 },
          { l: "Parciais", v: cards?.rotas_parciais ?? 0 },
          { l: "Pacotes em risco", v: cards?.pacotes ?? 0 },
          { l: "Entregues", v: cards?.entregue ?? 0 },
          { l: "Pendentes", v: cards?.pendente ?? 0 },
          { l: "Insucessos", v: cards?.insucesso ?? 0 },
        ].map((c) => (
          <Card key={c.l}>
            <CardContent className="pt-4">
              <div className="text-xs uppercase text-muted-foreground">{c.l}</div>
              <div className="text-2xl font-semibold tabular-nums">{c.v}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Rotas ({rotas.length}) — conclusão {pct(cards?.perc_conclusao ?? 0)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {riscoQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando rotas...
            </div>
          ) : riscoQuery.data?.status === "erro" ? (
            <div className="text-sm text-destructive flex items-center gap-2 py-4">
              <AlertTriangle className="h-4 w-4" /> {riscoQuery.data.erro}
            </div>
          ) : rotas.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">
              Nenhuma rota em área de risco para os filtros selecionados.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr className="text-left border-b">
                    <th className="py-2 pr-3">Rota</th>
                    <th className="py-2 pr-3">Base</th>
                    <th className="py-2 pr-3">Motorista</th>
                    <th className="py-2 pr-3">Risco</th>
                    <th className="py-2 pr-3 text-right">Total</th>
                    <th className="py-2 pr-3 text-right">Em risco</th>
                    <th className="py-2 pr-3 text-right">Entregues</th>
                    <th className="py-2 pr-3 text-right">Pendentes</th>
                    <th className="py-2 pr-3 text-right">Insucessos</th>
                    <th className="py-2 pr-3">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {rotas.map((r) => (
                    <tr
                      key={r.rota_id}
                      className="border-b last:border-0 hover:bg-muted/50 cursor-pointer"
                      onClick={() => setRotaAberta(r)}
                    >
                      <td className="py-2 pr-3 font-medium">
                        {r.cluster ?? r.route_id}
                        <div className="text-xs text-muted-foreground">{r.route_id}</div>
                      </td>
                      <td className="py-2 pr-3">{r.base_codigo ?? "—"}</td>
                      <td className="py-2 pr-3">
                        {r.driver_name ?? "—"}
                        <div className="text-xs text-muted-foreground">
                          {r.vehicle_license ?? ""}
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        {r.rota_area_risco ? (
                          <Badge variant="destructive">Integral</Badge>
                        ) : (
                          <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30">
                            Parcial
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.total}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.pacotes_risco}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.entregue_risco}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.pendente_risco}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.insucesso_risco}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {r.motivo_area_risco ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!rotaAberta} onOpenChange={(o) => !o && setRotaAberta(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {rotaAberta?.cluster ?? rotaAberta?.route_id} — pacotes em risco
            </DialogTitle>
          </DialogHeader>
          {rotaAberta && (
            <p className="text-xs text-muted-foreground">
              Base {rotaAberta.base_codigo ?? "—"} · Motorista {rotaAberta.driver_name ?? "—"} ·
              Origem do risco: {rotaAberta.origem_area_risco ?? "—"}
            </p>
          )}
          <ScrollArea className="h-[60vh]">
            {pacotesQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando pacotes...
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr className="text-left border-b">
                    <th className="py-2 pr-3">Tracking</th>
                    <th className="py-2 pr-3">Situação</th>
                    <th className="py-2 pr-3">Ocorrência</th>
                    <th className="py-2 pr-3">Risco</th>
                  </tr>
                </thead>
                <tbody>
                  {(pacotesQuery.data?.pacotes ?? []).map((p) => (
                    <tr key={p.tracking_id} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-mono text-xs">{p.tracking_id}</td>
                      <td className="py-2 pr-3">{p.situacao}</td>
                      <td className="py-2 pr-3 text-xs">
                        {p.descricao_ocorrencia ?? p.occurrence_code ?? "—"}
                      </td>
                      <td className="py-2 pr-3">
                        {p.pacote_area_risco ? (
                          <Badge variant="destructive">Sim</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
