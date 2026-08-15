import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState, useEffect } from "react";
import { toast } from "sonner";
import {
  meliDevolucoesCriarDevolucao,
  meliDevolucoesBipar,
  meliDevolucoesListar,
  meliDevolucoesFinalizar,
  meliDevolucoesCancelar,
  meliDevolucoesDetalhar,
} from "@/lib/meli-devolucoes.functions";
import { meuPerfil } from "@/lib/recebimento.functions";



import { listarBasesSimples } from "@/lib/bases.functions";

import {
  CLASSE_FAIXA,
  LABEL_ESTADO,
  faixaVisual,
  validarRecebimento,
  type EstadoDevolucao,
} from "@/lib/meli-devolucoes-domain";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle,
  Download,
  Loader2,
  PackageCheck,
  RefreshCcw,
  RotateCcw,
  Printer,
} from "lucide-react";
import { hojeOperacional } from "@/lib/dia-operacional";
import { beepOk, beepError, startAlarm, stopAlarm } from "@/lib/scanner-sound";

export const Route = createFileRoute("/_authenticated/meli-devolucoes")({
  head: () => ({
    meta: [
      { title: "Devoluções — JMRoutes" },
      {
        name: "description",
        content:
          "Controle de devoluções: prazo de retorno de 3 dias, recebimento físico na base e alertas de divergência.",
      },
      { property: "og:title", content: "Devoluções — JMRoutes" },
      {
        property: "og:description",
        content: "Acompanhe prazos, recebimento físico e divergências das devoluções.",
      },

      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MeliDevolucoesPage,
});

const ESTADOS: EstadoDevolucao[] = [
  "aguardando_retorno",
  "proximo_do_prazo",
  "atrasado",
  "recebido_na_base",
  "em_investigacao",
  "transferido",
  "divergencia_delivered",
  "revisao_necessaria",
];

function fmt(dt: string | null | undefined) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function MeliDevolucoesPage() {
  const fetchPerfil = useServerFn(meuPerfil);
  const perfilQuery = useQuery({
    queryKey: ["meu-perfil"],
    queryFn: () => fetchPerfil(),
    staleTime: 60_000,
  });
  const userId = perfilQuery.data?.profile?.id;

  const abrirDevolucao = useServerFn(meliDevolucoesCriarDevolucao);
  const biparDevolucao = useServerFn(meliDevolucoesBipar);
  const finalizar = useServerFn(meliDevolucoesFinalizar);
  const listarDevolucoes = useServerFn(meliDevolucoesListar);
  const cancelarDevolucao = useServerFn(meliDevolucoesCancelar);
  const detalharDevolucao = useServerFn(meliDevolucoesDetalhar);


  const buscarBases = useServerFn(listarBasesSimples);




  const hoje = hojeOperacional();
  const [dataDe, setDataDe] = useState(() => {
    const d = new Date(`${hoje}T12:00:00`);
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [dataAte, setDataAte] = useState(hoje);
  const [baseId, setBaseId] = useState("");
  const [estado, setEstado] = useState("");
  const [busca, setBusca] = useState("");

  const [codigo, setCodigo] = useState("");
  const [observacao, setObservacao] = useState("");
  const [buscarRecId, setBuscarRecId] = useState("");
  const [gerandoRec, setGerandoRec] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [alertaCritico, setAlertaCritico] = useState<string | null>(null);

  // v3: Identificadores de estado ativo
  // Chave de persistência local: active_romaneio_uuid:{user_id}:{base_id}
  const [romaneioUuid, setRomaneioUuid] = useState("");
  const [recebimentoId, setRecebimentoId] = useState("");
  const [iniciandoRecebimento, setIniciandoRecebimento] = useState(false);
  const [isCapturingFirst, setIsCapturingFirst] = useState(false);

  // v3: Identificadores de estado ativo chaveados por base
  const storageKeyUuid = useMemo(() => `active_romaneio_uuid:${userId}:${baseId}`, [userId, baseId]);
  const storageKeyRec = useMemo(() => `active_rec_id:${userId}:${baseId}`, [userId, baseId]);

  // Carrega estado inicial quando baseId ou userId mudar
  useEffect(() => {
    if (!userId || !baseId) {
      setRomaneioUuid("");
      setRecebimentoId("");
      setIniciandoRecebimento(false);
      return;
    }

    const savedUuid = localStorage.getItem(storageKeyUuid);
    const savedRec = localStorage.getItem(storageKeyRec);

    if (savedUuid && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(savedUuid)) {
      setRomaneioUuid(savedUuid);
      setRecebimentoId(savedRec || "");
      setIniciandoRecebimento(true);
    } else if (savedRec === "NOVO") {
      setRecebimentoId("NOVO");
      setRomaneioUuid("");
      setIniciandoRecebimento(true);
    } else {
      setRomaneioUuid("");
      setRecebimentoId("");
      setIniciandoRecebimento(false);
    }
  }, [userId, baseId, storageKeyUuid, storageKeyRec]);

  const updateActiveRec = (id: string, uuid?: string) => {
    if (!userId || !baseId) return;

    // Limpeza
    if (!id || (id !== "NOVO" && !uuid)) {
      setRecebimentoId("");
      setRomaneioUuid("");
      localStorage.removeItem(storageKeyUuid);
      localStorage.removeItem(storageKeyRec);
      setIniciandoRecebimento(false);
      return;
    }

    if (id === "NOVO") {
      setRecebimentoId("NOVO");
      setRomaneioUuid("");
      localStorage.setItem(storageKeyRec, "NOVO");
      localStorage.removeItem(storageKeyUuid);
      setIniciandoRecebimento(true);
      return;
    }

    // Validação de UUID antes de persistir
    if (uuid && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
      console.warn("Tentativa de ativar romaneio com UUID inválido:", uuid);
      return;
    }


    setRecebimentoId(id);
    setRomaneioUuid(uuid || "");
    localStorage.setItem(storageKeyRec, id);
    if (uuid) localStorage.setItem(storageKeyUuid, uuid);
    setIniciandoRecebimento(true);

  };

  const [pacotesDesteLote, setPacotesDesteLote] = useState<any[]>([]);



  const [detalhe, setDetalhe] = useState<any | null>(null);
  const [cardDetalhe, setCardDetalhe] = useState<{ id: string; label: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const basesQuery = useQuery({
    queryKey: ["bases-simples"],
    queryFn: () => buscarBases(),
    staleTime: 300_000,
  });

  const painelQuery = useQuery({
    queryKey: ["meli-devolucoes", dataDe, dataAte, baseId, estado],
    queryFn: () => ({} as any), // TODO: Implementar busca de painel se necessário
    refetchInterval: 60_000,
  });

  const romaneiosQuery = useQuery({
    queryKey: ["meli-romaneios", baseId, dataDe, dataAte],
    queryFn: async () => {
      try {
        return await listarDevolucoes({ data: { base_id: baseId || null, data_de: dataDe, data_ate: dataAte } });
      } catch (err) {
        console.error("Erro ao listar romaneios:", err);
        throw err;
      }
    },
    enabled: !!baseId || !!dataDe,
  });

  // Validação de romaneio ativo ao carregar
  useQuery({
    queryKey: ["meli-romaneio-ativo-check", romaneioUuid],
    queryFn: async () => {
      if (!romaneioUuid) {
        setIniciandoRecebimento(false);
        return null;
      }
      try {
        const res = (await detalharDevolucao({ data: { romaneio_id: romaneioUuid } })) as any;

        // Se não existir, estiver concluído/cancelado ou base diferente (se baseId selecionada), descarta
        if (!res || res.status !== "em_andamento" || (baseId && res.base_id !== baseId)) {
          updateActiveRec("");
          return null;
        }
        setIniciandoRecebimento(true);
        // Atualiza o ID visual caso tenha mudado ou não estivesse sincronizado
        if (res.codigo && res.codigo !== recebimentoId) {
          setRecebimentoId(res.codigo);
          localStorage.setItem("active_rec_id", res.codigo);
        }
        return res;
      } catch (err) {
        console.warn("UUID ativo inválido ou erro na consulta:", err);
        updateActiveRec("");
        return null;
      }
    },
    enabled: !!romaneioUuid,
    staleTime: 0, // Sempre verifica ao montar ou mudar UUID
  });


  const historicoQuery = useQuery({
    queryKey: ["meli-devolucao-historico", detalhe?.id],
    queryFn: () => ({} as any), // TODO: Implementar busca de histórico se necessário
    enabled: !!detalhe,
  });

  const linhas = useMemo(() => {
    const todas = painelQuery.data?.linhas ?? [];
    const q = busca.trim().toLowerCase();
    if (!q) return todas;
    return todas.filter((l: any) =>
      [l.tracking_id, l.route_id, l.cluster, l.motorista, l.base_codigo, l.occurrence_code]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [painelQuery.data, busca]);

  const cards = painelQuery.data?.cards;

  const linhasCard = useMemo(() => {
    if (!cardDetalhe) return [] as any[];
    if (!cardDetalhe.id) return linhas;
    if (cardDetalhe.id === "divergencia_delivered")
      return linhas.filter((l: any) => l.divergencia_delivered);
    return linhas.filter((l: any) => l.estado === cardDetalhe.id);
  }, [linhas, cardDetalhe]);

  async function onSincronizar() {
    toast.info("Funcionalidade em migração.");
  }

  async function onGerarRecebimento() {
    if (!baseId) {
      toast.error("Selecione a base ANTES de gerar o recebimento.");
      setIniciandoRecebimento(false);
      return;
    }
    setGerandoRec(true);
    try {
      // Abertura automática agora requer o primeiro pacote biapdo
      toast.info("Para criar uma nova devolução, bipe o primeiro pacote.");
      updateActiveRec("NOVO"); // Sinalizador visual de que estamos abrindo
      setPacotesDesteLote([]);
    } finally {
      setGerandoRec(false);
    }
  }



  async function onReceber(e: React.FormEvent) {
    e.preventDefault();
    const bloqueio = validarRecebimento({ codigo, baseSelecionadaId: baseId || null });
    if (bloqueio === "sem_base") {
      toast.error("Selecione a base de recebimento antes de bipar.");
      return;
    }
    if (bloqueio === "sem_codigo") return;

    if (!recebimentoId) {
      toast.error("Gere um ID de recebimento antes de iniciar as bipagens.");
      return;
    }

    setEnviando(true);
    try {
      let res;
      if (recebimentoId === "NOVO") {
        // Abre o romaneio com o primeiro pacote
        res = await abrirDevolucao({
          data: {
            base_id: baseId,
            tracking_id: codigo.trim(),
            observacao: observacao.trim() || null,
          }
        });
        if (res && typeof res === 'object' && 'romaneio_id' in res) {
          // UUID é obrigatório para fluxo v3
          updateActiveRec(res.codigo_romaneio as string, res.romaneio_id as string);
        }
      } else {
        // Bipa em romaneio existente usando UUID
        if (!romaneioUuid || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(romaneioUuid)) {
           toast.error("Sessão expirada ou identificador inválido. Reabra a devolução.");
           updateActiveRec("");
           return;
        }
        res = await biparDevolucao({

          data: {
            romaneio_id: romaneioUuid,
            base_id: baseId,
            tracking_id: codigo.trim(),
            observacao: observacao.trim() || null,
          },
        });
      }
      
      // ... processamento de resposta ...
      if (res && typeof res === 'object' && 'status' in res && res.status === "erro") {
        beepError();
        toast.error((res as any).mensagem ?? "Não foi possível registrar o retorno.");
      } else if (res && typeof res === 'object' && 'status' in res && res.status === "duplicado") {
        beepError();
        toast.error((res as any).mensagem ?? "Divergência: pacote já lido/recebido nesta devolução.");
      } else if (res && typeof res === 'object' && 'divergencia_delivered' in res && res.divergencia_delivered) {
        startAlarm();
        setAlertaCritico(
          (res as any).mensagem ??
            `Pacote ${(res as any).tracking_id} retornou fisicamente, porém o sistema indica ENTREGUE. Registre a divergência.`,
        );
      } else {
        beepOk();
        const tid = res && typeof res === 'object' && 'tracking_id' in res ? res.tracking_id : '';
        toast.success((res as any).mensagem ?? `Retorno de ${tid} registrado.`);
        // Tenta encontrar o pacote nas linhas atuais para exibir na lista do lote
        const p = linhas.find((l: any) => l.tracking_id === tid);
        if (p) {
          setPacotesDesteLote(prev => [p, ...prev]);
        }
      }
      setCodigo("");
      setObservacao("");
      inputRef.current?.focus();
      painelQuery.refetch();
    } catch (err: any) {
      beepError();
      toast.error(err.message || "Erro ao processar bipagem.");
    } finally {
      setEnviando(false);
    }
  }


  function exportarCsv() {
    const head = [
      "tracking",
      "base",
      "rota",
      "motorista",
      "ocorrencia",
      "ocorrido_em",
      "prazo_retorno",
      "estado",
      "dias",
      "recebido_em",
      "divergencia_meli_entregue",
    ];
    const body = linhas.map((l: any) => [
      l.tracking_id,
      l.base_codigo ?? "",
      l.cluster ?? l.route_id ?? "",
      l.motorista ?? "",
      l.occurrence_code,
      l.ocorrido_em,
      l.prazo_retorno_em,
      LABEL_ESTADO[l.estado as EstadoDevolucao] ?? l.estado,
      l.dias_corridos,
      l.recebido_em ?? "",
      l.divergencia_delivered ? "SIM" : "",
    ]);
    const csv = [head, ...body]
      .map((l: any) => l.map((c: any) => `"${String(c).replaceAll('"', '""')}"`).join(";"))
      .join("\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `devolucoes-${dataDe}_${dataAte}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold flex items-center gap-2">
            <RotateCcw className="h-6 w-6 text-primary" />
            Devoluções
          </h1>
          <p className="text-sm text-muted-foreground">
            Todo pacote com ocorrência de rua deve retornar à base de origem em até 3 dias corridos.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onSincronizar}>
            <RefreshCcw className="h-4 w-4 mr-2" /> Sincronizar
          </Button>

          <Button variant="outline" size="sm" onClick={exportarCsv} disabled={linhas.length === 0}>
            <Download className="h-4 w-4 mr-2" /> CSV
          </Button>
        </div>
      </header>

      <Card>
        <CardContent className="grid gap-3 md:grid-cols-5 pt-4">
          <div className="space-y-1">
            <Label htmlFor="dev-de">De</Label>
            <Input id="dev-de" type="date" value={dataDe} onChange={(e) => setDataDe(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dev-ate">Até</Label>
            <Input id="dev-ate" type="date" value={dataAte} onChange={(e) => setDataAte(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dev-base">Base</Label>
            <select
              id="dev-base"
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
            <Label htmlFor="dev-estado">Estado</Label>
            <select
              id="dev-estado"
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={estado}
              onChange={(e) => setEstado(e.target.value)}
            >
              <option value="">Todos</option>
              {ESTADOS.map((e) => (
                <option key={e} value={e}>
                  {LABEL_ESTADO[e]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="dev-busca">Buscar</Label>
            <Input
              id="dev-busca"
              placeholder="Tracking, rota, motorista..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
        {[
          { id: "", l: "Total", v: cards?.total ?? 0, c: "" },
          { id: "aguardando_retorno", l: "Aguardando", v: cards?.aguardando_retorno ?? 0, c: CLASSE_FAIXA.verde },
          { id: "proximo_do_prazo", l: "Próximo do prazo", v: cards?.proximo_do_prazo ?? 0, c: CLASSE_FAIXA.amarelo },
          { id: "atrasado", l: "Atrasado", v: cards?.atrasado ?? 0, c: CLASSE_FAIXA.vermelho },
          { id: "recebido_na_base", l: "Recebidos", v: cards?.recebido_na_base ?? 0, c: CLASSE_FAIXA.verde },
          {
            id: "divergencia_delivered",
            l: "Divergência Status",
            v: cards?.divergencia_delivered ?? 0,
            c: CLASSE_FAIXA.critico,
          },
        ].map((c) => (

          <Card
            key={c.l}
            role="button"
            tabIndex={0}
            className={`cursor-pointer transition-colors hover:bg-muted/50 ${c.c ? `border ${c.c}` : ""} ${estado === c.id ? "ring-2 ring-primary" : ""}`}
            onClick={() => {
              setEstado(c.id);
              setCardDetalhe({ id: c.id, label: c.l });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                setEstado(c.id);
                setCardDetalhe({ id: c.id, label: c.l });
              }
            }}
          >
            <CardContent className="pt-4">
              <div className="text-xs uppercase text-muted-foreground">{c.l}</div>
              <div className="text-2xl font-semibold tabular-nums">{c.v}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!cardDetalhe} onOpenChange={(o) => !o && setCardDetalhe(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center justify-between">
              <span>{cardDetalhe?.label} — {linhasCard.length} pacote(s)</span>
              {linhasCard.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => window.print()}
                >
                  <Printer className="h-4 w-4 mr-2" /> Imprimir devolução
                </Button>
              )}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            {linhasCard.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6">
                Nenhum pacote nesta situação para os filtros atuais.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr className="text-left border-b">
                    <th className="py-2 pr-3">Tracking</th>
                    <th className="py-2 pr-3">Base</th>
                    <th className="py-2 pr-3">Rota / motorista</th>
                    <th className="py-2 pr-3">Ocorrência</th>
                    <th className="py-2 pr-3">Prazo</th>
                    <th className="py-2 pr-3 text-right">Dias</th>
                  </tr>
                </thead>
                <tbody>
                  {linhasCard.map((l: any) => (
                    <tr
                      key={l.id}
                      className="border-b last:border-0 hover:bg-muted/50 cursor-pointer"
                      onClick={() => {
                        setCardDetalhe(null);
                        setDetalhe(l);
                      }}
                    >
                      <td className="py-2 pr-3 font-mono text-xs">{l.tracking_id}</td>
                      <td className="py-2 pr-3">{l.base_codigo ?? "—"}</td>
                      <td className="py-2 pr-3">
                        {l.cluster ?? l.route_id ?? "—"}
                        <div className="text-xs text-muted-foreground">{l.motorista ?? ""}</div>
                      </td>
                      <td className="py-2 pr-3 text-xs">{l.occurrence_code}</td>
                      <td className="py-2 pr-3 text-xs">{fmt(l.prazo_retorno_em)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{l.dias_corridos}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {!iniciandoRecebimento ? (
        <Card className="flex items-center justify-center py-12">
          <CardContent>
            <Button
              size="lg"
              className="px-8 py-6 text-lg h-auto"
              onClick={() => {
                if (!baseId) {
                  toast.error("Selecione a base ANTES de gerar o recebimento.");
                  return;
                }
                onGerarRecebimento();
              }}
              disabled={gerandoRec}
            >
              {gerandoRec ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Iniciando...
                </>
              ) : (
                "Gerar ou Iniciar Recebimento"
              )}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="py-4 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="bg-primary text-primary-foreground p-3 rounded-full">
                  <PackageCheck className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-xl font-bold font-mono">{recebimentoId}</h2>
                  <p className="text-sm text-muted-foreground uppercase tracking-wider">Recebimento em andamento</p>
                </div>
              </div>
              <div className="flex flex-col md:flex-row gap-2 items-stretch md:items-center">
                <div className="flex gap-2">
                  <Input
                    className="h-8 w-40 font-mono text-xs"
                    placeholder="REC..."
                    value={buscarRecId}
                    onChange={(e) => setBuscarRecId(e.target.value)}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 px-3"
                    onClick={async () => {
                      if (!buscarRecId.trim()) return;
                      const q = buscarRecId.trim().toUpperCase();
                      // Tenta localizar o UUID do romaneio pelo código
                      try {
                        const romaneios = (await listarDevolucoes({ data: { base_id: baseId || null } })) as any[];
                        const encontrado = romaneios?.find((r: any) => r.codigo === q);
                        if (encontrado) {
                          updateActiveRec(encontrado.codigo, encontrado.id);
                          setPacotesDesteLote([]);
                          toast.info(`Continuando conferência: ${encontrado.codigo}`);
                        } else {
                          toast.error("Devolução não encontrada para esta base.");
                        }
                      } catch (err) {
                        toast.error("Erro ao buscar devolução.");
                      }
                    }}
                  >
                    Continuar
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={async () => {
                      const activeUuid = localStorage.getItem("active_romaneio_uuid");
                      if (!activeUuid || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(activeUuid)) {
                        updateActiveRec("");
                        return;
                      }
                      try {
                        await finalizar({ data: { romaneio_id: activeUuid } });
                        toast.success("Devolução finalizada com sucesso.");
                        updateActiveRec("");
                        painelQuery.refetch();
                      } catch (err: any) {
                        toast.error(err.message || "Erro ao finalizar devolução.");
                      }
                    }}
                  >
                    Finalizar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => {
                      updateActiveRec("");
                      onGerarRecebimento();
                    }}
                    disabled={gerandoRec}
                  >
                    {gerandoRec ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4 mr-2" />}
                    Novo
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    onClick={() => {
                      updateActiveRec("");
                      stopAlarm();
                    }}
                  >
                    Sair
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>



          <Card className="border-primary/20 shadow-sm">
            <CardHeader className="pb-2 border-b border-border/50 bg-muted/5">
              <CardTitle className="text-base flex items-center gap-2">
                Bipagem de Pacotes
              </CardTitle>
            </CardHeader>
          <CardContent className="pt-6">
            <form
              className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                onReceber(e);
              }}
            >

              <div className="space-y-1">
                <Label htmlFor="dev-codigo">Bipe o ID do pacote devolvido</Label>
                <Input
                  id="dev-codigo"
                  ref={inputRef}
                  autoFocus
                  autoComplete="off"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  disabled={!recebimentoId}
                  placeholder="Tracking / shipment"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="dev-obs">Observação (opcional)</Label>
                <Input
                  id="dev-obs"
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  disabled={!recebimentoId}
                  placeholder="Avaria, embalagem aberta..."
                />
              </div>
              <Button type="submit" disabled={enviando || !codigo.trim() || !recebimentoId}>
                {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Registrar retorno"}
              </Button>
            </form>

            <p className="text-xs text-muted-foreground mt-2">
              O recebimento só é registrado por leitura física. Mudança de status externa nunca marca
              um pacote como recebido.
            </p>

            {pacotesDesteLote.length > 0 && (
              <div className="mt-6 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Bipados neste lote ({pacotesDesteLote.length})</h3>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="h-7 text-[10px] uppercase tracking-wider"
                    onClick={() => window.print()}
                  >
                    <Printer className="h-3 w-3 mr-1.5" /> Imprimir devolução
                  </Button>
                </div>
                <ScrollArea className="h-48 border rounded-md">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 text-muted-foreground sticky top-0">
                      <tr className="text-left border-b">
                        <th className="py-2 px-3">Tracking</th>
                        <th className="py-2 px-3">Rota</th>
                        <th className="py-2 px-3">Ocorrência</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pacotesDesteLote.map((p) => (
                        <tr key={p.id} className="border-b last:border-0">
                          <td className="py-2 px-3 font-mono">{p.tracking_id}</td>
                          <td className="py-2 px-3">{p.cluster ?? p.route_id ?? "—"}</td>
                          <td className="py-2 px-3">{p.occurrence_code}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              </div>

              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Devoluções Recentes</CardTitle>
        </CardHeader>
        <CardContent>
          {romaneiosQuery.isLoading ? (
            <div className="flex flex-col items-center justify-center py-6 gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Carregando devoluções...</p>
            </div>
          ) : romaneiosQuery.isError ? (
            <div className="flex flex-col items-center justify-center py-6 gap-3">
              <AlertTriangle className="h-6 w-6 text-destructive" />
              <p className="text-sm text-destructive font-medium">Erro ao carregar devoluções</p>
              <Button size="sm" variant="outline" onClick={() => romaneiosQuery.refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : (romaneiosQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Nenhuma devolução recente.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr className="text-left border-b">
                    <th className="py-2 pr-3">Código</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Data</th>
                    <th className="py-2 pr-3">Rota</th>
                    <th className="py-2 pr-3">Motorista</th>
                    <th className="py-2 pr-3 text-right">Pacotes</th>
                  </tr>
                </thead>
                <tbody>
                  {(romaneiosQuery.data ?? []).map((r: any) => (
                    <tr
                      key={r.id}
                      className="border-b last:border-0 hover:bg-muted/50 cursor-pointer"
                      onClick={() => {
                        updateActiveRec(r.codigo, r.id);
                        setPacotesDesteLote([]);
                      }}
                    >
                      <td className="py-2 pr-3 font-mono text-xs">{r.codigo}</td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline" className={`text-[10px] uppercase ${r.status === 'em_andamento' ? 'bg-green-500/10 text-green-600 border-green-200' : ''}`}>
                          {r.status.replace("_", " ")}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 text-xs">{fmt(r.aberto_em)}</td>
                      <td className="py-2 pr-3 text-xs">{r.route_id ?? "—"}</td>
                      <td className="py-2 pr-3 text-xs">{r.motorista ?? "—"}</td>
                      <td className="py-2 pr-3 text-right text-xs">{r.total_pacotes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>



      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Devoluções ({linhas.length}) — SLA {Number(cards?.perc_sla ?? 0).toFixed(1)}%
          </CardTitle>
        </CardHeader>
        <CardContent>
          {painelQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando devoluções...
            </div>
          ) : painelQuery.data?.status === "erro" ? (
            <div className="text-sm text-destructive flex items-center gap-2 py-4">
              <AlertTriangle className="h-4 w-4" /> {painelQuery.data.erro}
            </div>
          ) : linhas.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">
              Nenhuma devolução para os filtros selecionados.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr className="text-left border-b">
                    <th className="py-2 pr-3">Tracking</th>
                    <th className="py-2 pr-3">Base</th>
                    <th className="py-2 pr-3">Rota / motorista</th>
                    <th className="py-2 pr-3">Ocorrência</th>
                    <th className="py-2 pr-3">Ocorrido</th>
                    <th className="py-2 pr-3">Prazo</th>
                    <th className="py-2 pr-3 text-right">Dias</th>
                    <th className="py-2 pr-3">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l: any) => {
                    const faixa = faixaVisual({
                      estado: l.estado as EstadoDevolucao,
                      prazo_retorno_em: l.prazo_retorno_em,
                      recebido_em: l.recebido_em,
                      divergencia_delivered: l.divergencia_delivered,
                    });
                    return (
                      <tr
                        key={l.id}
                        className="border-b last:border-0 hover:bg-muted/50 cursor-pointer"
                        onClick={() => setDetalhe(l)}
                      >
                        <td className="py-2 pr-3 font-mono text-xs">{l.tracking_id}</td>
                        <td className="py-2 pr-3">{l.base_codigo ?? "—"}</td>
                        <td className="py-2 pr-3">
                          {l.cluster ?? l.route_id ?? "—"}
                          <div className="text-xs text-muted-foreground">{l.motorista ?? ""}</div>
                        </td>
                        <td className="py-2 pr-3 text-xs">{l.occurrence_code}</td>
                        <td className="py-2 pr-3 text-xs">{fmt(l.ocorrido_em)}</td>
                        <td className="py-2 pr-3 text-xs">{fmt(l.prazo_retorno_em)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{l.dias_corridos}</td>
                        <td className="py-2 pr-3">
                          <Badge className={CLASSE_FAIXA[faixa]}>
                            {LABEL_ESTADO[l.estado as EstadoDevolucao] ?? l.estado}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!detalhe} onOpenChange={(o) => !o && setDetalhe(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-base">
              {detalhe?.tracking_id}
            </DialogTitle>
          </DialogHeader>
          {detalhe && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-muted-foreground">Base de origem:</span>{" "}
                  {detalhe.base_codigo ?? "—"}
                </div>
                <div>
                  <span className="text-muted-foreground">Rota:</span>{" "}
                  {detalhe.cluster ?? detalhe.route_id ?? "—"}
                </div>
                <div>
                  <span className="text-muted-foreground">Ocorrência:</span>{" "}
                  {detalhe.occurrence_code}
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  {detalhe.situacao_meli ?? detalhe.meli_status ?? "—"}
                </div>
                <div>
                  <span className="text-muted-foreground">Prazo de retorno:</span>{" "}
                  {fmt(detalhe.prazo_retorno_em)}
                </div>
                <div>
                  <span className="text-muted-foreground">Recebido em:</span>{" "}
                  {fmt(detalhe.recebido_em)}
                </div>
                {detalhe.recebimento_id && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">ID Recebimento:</span>{" "}
                    <span className="font-mono text-xs">{detalhe.recebimento_id}</span>
                  </div>
                )}
              </div>
              {detalhe.divergencia_delivered && (
                <div className="rounded-md border border-purple-600/40 bg-purple-600/10 p-3 text-purple-500 text-sm">
                  Divergência crítica: pacote recebido fisicamente, mas o sistema indica entrega ao
                  cliente.
                </div>
              )}

              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">Histórico</div>
                <ScrollArea className="h-48 rounded-md border p-2">
                  {historicoQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Carregando...
                    </div>
                  ) : (historicoQuery.data ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">Sem eventos registrados.</p>
                  ) : (
                    <ul className="space-y-1 text-xs">
                      {(historicoQuery.data ?? []).map((ev: any) => (
                        <li key={ev.id} className="flex gap-2">
                          <span className="text-muted-foreground">{fmt(ev.created_at)}</span>
                          <span>{ev.tipo}</span>
                          {ev.estado_novo && (
                            <span className="text-muted-foreground">→ {ev.estado_novo}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </ScrollArea>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!alertaCritico}
        onOpenChange={(o) => {
          if (!o) {
            stopAlarm();
            setAlertaCritico(null);
          }
        }}
      >
        <DialogContent className="max-w-lg border-purple-600/50">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-purple-500">
              <AlertTriangle className="h-5 w-5" /> Divergência crítica
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm">{alertaCritico}</p>
          <Textarea
            placeholder="Descreva a divergência para o histórico (opcional)"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
          />
          <Button
            onClick={() => {
              stopAlarm();
              setAlertaCritico(null);
            }}
          >
            Entendi, registrar e continuar
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
