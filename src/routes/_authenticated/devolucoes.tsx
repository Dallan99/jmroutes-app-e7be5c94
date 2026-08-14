import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listarDevolucoes,
  cancelarDevolucao,
  MOTIVOS,
  normalizarRotaDevolucao,
  filtrarDevolucoesPorRota,
  type MotivoDevolucao,
} from "@/lib/devolucoes.functions";
import {
  criarLoteDevolucao,
  loteAbertoDevolucao,
  biparLoteDevolucao,
  finalizarLoteDevolucao,
  listarLotesDevolucao,
  type BiparLoteResult,
  type FinalizarLoteResult,
} from "@/lib/devolucao-lotes.functions";
import {
  CLASSE_TRATAMENTO,
  LABEL_TRATAMENTO,
  type TratamentoDevolucao,
} from "@/lib/devolucao-lotes-domain";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RequireBaseOperacional } from "@/components/base-operacional-selector";
import { useBaseOperacional } from "@/lib/base-operacional-context";
import { beepError, beepOk, beepWarn } from "@/lib/scanner-sound";
import { toast } from "sonner";
import {
  RotateCcw,
  ScanLine,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Trash2,
  Printer,
  Download,
  ChevronRight,
  ChevronDown,
  PackagePlus,
} from "lucide-react";
import { abrirRelatorio, baixarCSV } from "@/lib/relatorio";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/_authenticated/devolucoes")({
  head: () => ({
    meta: [
      { title: "Devoluções — JM Transportes" },
      {
        name: "description",
        content:
          "Recebimento de insucessos por lote automático, com motivo real registrado pelo motorista no Meli.",
      },
      { property: "og:title", content: "Devoluções — JM Transportes" },
      {
        property: "og:description",
        content: "Lotes automáticos de devolução e motivo automático do Meli.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DevolucoesGuard,
});

function DevolucoesGuard() {
  return (
    <RequireBaseOperacional
      titulo="Devoluções"
      descricao="Selecione a Base e o Dia Operacional. Cada devolução ficará vinculada a esta seleção."
    >
      <DevolucoesComHeader />
    </RequireBaseOperacional>
  );
}

function hojeBRT(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

function DevolucoesComHeader() {
  const { base, diaOperacional, trocarDia, limpar } = useBaseOperacional();
  const hoje = hojeBRT();
  const diaDivergente = !!diaOperacional && diaOperacional !== hoje;
  return (
    <>
      <div className="border-b bg-muted/30 px-4 md:px-6 py-2 flex items-center gap-3 flex-wrap text-xs">
        <span className="font-display font-semibold text-sm">Devoluções</span>
        <span className="text-muted-foreground">·</span>
        <span>
          Base: <b>{base?.nome ?? "—"}</b>
          {base?.codigo && (
            <span className="font-mono text-muted-foreground"> ({base.codigo})</span>
          )}
        </span>
        <span className="text-muted-foreground">·</span>
        <span>
          Dia Operacional:{" "}
          <b className="font-mono">
            {diaOperacional
              ? new Date(diaOperacional + "T00:00:00").toLocaleDateString("pt-BR")
              : "—"}
          </b>
        </span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-7 text-xs"
          onClick={() => limpar()}
        >
          Trocar base / dia
        </Button>
      </div>
      {diaDivergente && (
        <div className="border-b bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100 px-4 md:px-6 py-2 flex items-start gap-3 flex-wrap text-xs">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="flex-1 min-w-[240px]">
            O Dia Operacional está em{" "}
            <b>{new Date(diaOperacional! + "T00:00:00").toLocaleDateString("pt-BR")}</b>, mas hoje é{" "}
            <b>{new Date(hoje + "T00:00:00").toLocaleDateString("pt-BR")}</b>. Novas devoluções são
            registradas com o horário atual e não aparecem em “Devoluções do dia” até você atualizar.
          </span>
          <Button size="sm" variant="outline" onClick={() => trocarDia(hoje)}>
            Atualizar para hoje
          </Button>
        </div>
      )}
      <DevolucoesPage />
    </>
  );
}

function DevolucoesPage() {
  const qc = useQueryClient();
  const { base, diaOperacional } = useBaseOperacional();
  const listarFn = useServerFn(listarDevolucoes);
  const cancelarFn = useServerFn(cancelarDevolucao);
  const criarLoteFn = useServerFn(criarLoteDevolucao);
  const loteAbertoFn = useServerFn(loteAbertoDevolucao);
  const biparFn = useServerFn(biparLoteDevolucao);
  const finalizarFn = useServerFn(finalizarLoteDevolucao);
  const listarLotesFn = useServerFn(listarLotesDevolucao);

  const inputRef = useRef<HTMLInputElement>(null);
  const [codigo, setCodigo] = useState("");
  const [ultimo, setUltimo] = useState<BiparLoteResult | null>(null);
  const [diaHistorico, setDiaHistorico] = useState<string>(diaOperacional ?? "");
  const diaAtivo = diaHistorico || diaOperacional;
  const consultandoHoje = diaAtivo === diaOperacional;

  // Divergência crítica (Meli entregue) — única situação que pede observação.
  const [divergencia, setDivergencia] = useState<{ codigo: string; mensagem: string } | null>(null);
  const [obsDivergencia, setObsDivergencia] = useState("");
  const [resumoFinal, setResumoFinal] = useState<FinalizarLoteResult | null>(null);

  const loteQuery = useQuery({
    queryKey: ["devolucao-lote-aberto", base?.id, diaOperacional],
    queryFn: () => loteAbertoFn({ data: { baseId: base!.id, diaOperacional: diaOperacional! } }),
    enabled: !!base && !!diaOperacional,
    refetchInterval: 15000,
  });
  const lote =
    loteQuery.data && "lote" in loteQuery.data ? (loteQuery.data.lote ?? null) : null;
  const loteAberto = !!lote && lote.estado === "aberta";

  const lotesQuery = useQuery({
    queryKey: ["devolucao-lotes", base?.id, diaAtivo],
    queryFn: () => listarLotesFn({ data: { baseId: base!.id, diaOperacional: diaAtivo! } }),
    enabled: !!base && !!diaAtivo,
  });

  const lista = useQuery({
    queryKey: ["devolucoes", base?.id, diaAtivo],
    queryFn: () => listarFn({ data: { baseId: base!.id, diaOperacional: diaAtivo! } }),
    enabled: !!base && !!diaAtivo,
    refetchInterval: consultandoHoje ? 6000 : false,
  });

  const invalidarTudo = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["devolucoes", base?.id] });
    qc.invalidateQueries({ queryKey: ["devolucao-lote-aberto", base?.id] });
    qc.invalidateQueries({ queryKey: ["devolucao-lotes", base?.id] });
  }, [qc, base?.id]);

  const criarLote = useMutation({
    mutationFn: () => criarLoteFn({ data: { baseId: base!.id, diaOperacional: diaOperacional! } }),
    onSuccess: (res) => {
      if (res.status === "erro") {
        beepError();
        toast.error(res.mensagem);
        return;
      }
      beepOk();
      toast.success(
        "lote" in res ? `Devolução criada: ${res.lote.nome_exibicao}` : "Devolução criada.",
      );

      invalidarTudo();
      setTimeout(() => inputRef.current?.focus(), 80);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao criar devolução."),
  });

  const bipar = useMutation({
    mutationFn: (args: { codigo: string; observacao?: string }) =>
      biparFn({
        data: { loteId: lote!.id, codigo: args.codigo, observacao: args.observacao ?? null },
      }),
    onSuccess: (res, vars) => {
      setUltimo(res);
      if (res.status === "ok") {
        beepOk();
        toast.success(res.mensagem ?? "Pacote registrado.");
        setDivergencia(null);
        setObsDivergencia("");
        invalidarTudo();
      } else if (res.status === "observacao_obrigatoria") {
        beepError();
        setDivergencia({ codigo: vars.codigo, mensagem: res.mensagem ?? "" });
      } else if (res.status === "duplicado" || res.status === "lote_finalizado") {
        beepWarn();
        toast.warning(res.mensagem ?? "Pacote já recebido.");
      } else {
        beepError();
        toast.error(res.mensagem ?? "Não foi possível registrar.");
      }
      setCodigo("");
      setTimeout(() => inputRef.current?.focus(), 50);
    },
    onError: (e) => {
      beepError();
      toast.error(e instanceof Error ? e.message : "Erro ao bipar pacote.");
    },
  });

  const finalizar = useMutation({
    mutationFn: () => finalizarFn({ data: { loteId: lote!.id } }),
    onSuccess: (res) => {
      if (res.status === "erro") {
        toast.error(res.mensagem ?? "Erro ao finalizar.");
        return;
      }
      setResumoFinal(res);
      toast.success("Devolução finalizada.");
      invalidarTudo();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao finalizar devolução."),
  });

  const cancelar = useMutation({
    mutationFn: (id: string) => cancelarFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Devolução cancelada.");
      invalidarTudo();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro"),
  });

  const registrarCodigo = useCallback(
    (cod: string) => {
      const c = cod.trim();
      if (!c || !loteAberto) return;
      bipar.mutate({ codigo: c });
    },
    [bipar, loteAberto],
  );

  const totalHoje = lista.data?.filter((d) => !d.cancelado).length ?? 0;

  type LinhaDev = NonNullable<typeof lista.data>[number];

  const colunasDevolucao = [
    {
      header: "Hora",
      value: (d: LinhaDev) => new Date(d.devolvido_em).toLocaleTimeString("pt-BR"),
    },
    { header: "Tracking", value: (d: LinhaDev) => d.shipment_codigo },
    { header: "Rota", value: (d: LinhaDev) => d.rota ?? "" },
    { header: "Motorista", value: (d: LinhaDev) => d.motorista ?? "" },
    { header: "Ocorrência Meli", value: (d: LinhaDev) => d.occurrence_code ?? "" },
    {
      header: "Motivo",
      value: (d: LinhaDev) =>
        d.motivo_descricao ?? MOTIVOS.find((m) => m.value === d.motivo)?.label ?? d.motivo,
    },
    {
      header: "Tratamento",
      value: (d: LinhaDev) =>
        d.tratamento ? LABEL_TRATAMENTO[d.tratamento as TratamentoDevolucao] : "",
    },
    { header: "Operador", value: (d: LinhaDev) => d.operador_nome ?? "" },
    { header: "Observação", value: (d: LinhaDev) => d.observacao ?? "" },
  ] as const;

  const relatorioConfig = () => {
    const linhas = (lista.data ?? []).filter((d) => !d.cancelado);
    return {
      titulo: "Devoluções do dia",
      subtitulo: `${base?.nome ?? ""} · ${diaAtivo ? new Date(diaAtivo + "T00:00:00").toLocaleDateString("pt-BR") : ""}`,
      nomeArquivo: `devolucoes_${base?.codigo ?? "base"}_${diaAtivo ?? ""}`,
      kpis: [{ label: "Total devolvido", value: linhas.length }],
      colunas: [...colunasDevolucao],
      linhas,
    };
  };
  const imprimir = () => {
    const ok = abrirRelatorio({ ...relatorioConfig(), autoPrint: true });
    if (!ok) toast.error("Bloqueador de pop-up impediu abrir o relatório.");
  };
  const baixarCsv = () => baixarCSV(relatorioConfig());

  // ── Lotes do dia (agrupamento principal) ───────────────────────────────────
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const toggle = (chave: string) =>
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(chave)) next.delete(chave);
      else next.add(chave);
      return next;
    });

  const linhasPorLote = useMemo(() => {
    const map = new Map<string, LinhaDev[]>();
    for (const l of (lista.data ?? []).filter((d) => !d.cancelado)) {
      const chave = l.lote_id ?? "__sem_lote__";
      const arr = map.get(chave) ?? [];
      arr.push(l);
      map.set(chave, arr);
    }
    return map;
  }, [lista.data]);

  const grupos = useMemo(() => {
    const lotes = (lotesQuery.data ?? []).map((l) => ({
      chave: l.id,
      label: l.nome_exibicao,
      estado: l.estado,
      linhas: (linhasPorLote.get(l.id) ?? []).sort(
        (a, b) => new Date(a.devolvido_em).getTime() - new Date(b.devolvido_em).getTime(),
      ),
    }));
    const semLote = linhasPorLote.get("__sem_lote__") ?? [];
    if (semLote.length > 0) {
      lotes.push({
        chave: "__sem_lote__",
        label: "Registros anteriores (sem lote)",
        estado: "finalizada" as const,
        linhas: semLote,
      });
    }
    return lotes.filter((g) => g.linhas.length > 0 || g.estado === "aberta");
  }, [lotesQuery.data, linhasPorLote]);

  const configLote = (grupo: { label: string; linhas: LinhaDev[] }) => {
    const porOcorrencia = new Map<string, number>();
    grupo.linhas.forEach((l) =>
      porOcorrencia.set(
        l.motivo_descricao ?? l.occurrence_code ?? "Sem ocorrência",
        (porOcorrencia.get(l.motivo_descricao ?? l.occurrence_code ?? "Sem ocorrência") ?? 0) + 1,
      ),
    );
    return {
      titulo: "Relatório de Devolução (lote)",
      subtitulo: `${base?.nome ?? ""}${base?.codigo ? ` (${base.codigo})` : ""} · ${grupo.label}`,
      nomeArquivo: `devolucao_${grupo.label.replace(/[^\w]+/g, "_")}`,
      kpis: [
        { label: "Total de pacotes", value: grupo.linhas.length },
        ...Array.from(porOcorrencia.entries()).map(([label, value]) => ({ label, value })),
      ],
      colunas: [...colunasDevolucao],
      linhas: grupo.linhas,
    };
  };
  const imprimirLote = (grupo: { label: string; linhas: LinhaDev[] }) => {
    const ok = abrirRelatorio({ ...configLote(grupo), autoPrint: true });
    if (!ok) toast.error("Bloqueador de pop-up impediu abrir o relatório.");
  };

  // Impressão por rota (mantida para conferência com o Meli)
  const [rotaDialogOpen, setRotaDialogOpen] = useState(false);
  const [rotaBusca, setRotaBusca] = useState("");
  const rotas = useMemo(() => {
    const set = new Map<string, { rotaAlvo: string | null; label: string; total: number }>();
    for (const l of (lista.data ?? []).filter((d) => !d.cancelado)) {
      const norm = normalizarRotaDevolucao(l.rota);
      const chave = norm ?? "__sem_rota__";
      const at = set.get(chave);
      if (at) at.total += 1;
      else set.set(chave, { rotaAlvo: norm, label: norm ?? "Sem rota", total: 1 });
    }
    return Array.from(set.values()).sort((a, b) =>
      a.label.localeCompare(b.label, "pt-BR", { numeric: true }),
    );
  }, [lista.data]);
  const rotasFiltradas = rotas.filter((r) =>
    r.label.toUpperCase().includes(rotaBusca.trim().toUpperCase()),
  );
  const imprimirRota = (r: { rotaAlvo: string | null; label: string }) => {
    const linhas = filtrarDevolucoesPorRota(lista.data ?? [], r.rotaAlvo);
    const ok = abrirRelatorio({
      ...relatorioConfig(),
      titulo: "Devoluções por rota",
      subtitulo: `${base?.nome ?? ""} · Rota ${r.label}`,
      nomeArquivo: `devolucoes_rota_${r.label.replace(/\s+/g, "_")}`,
      kpis: [{ label: "Total", value: linhas.length }],
      linhas,
      autoPrint: true,
    });
    if (!ok) toast.error("Bloqueador de pop-up impediu abrir o relatório.");
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <Card className="p-4 md:p-6">
        <div className="flex items-center gap-2 mb-4">
          <RotateCcw className="w-5 h-5 text-[var(--brand-yellow)]" />
          <h1 className="font-display text-xl font-bold">Devolução de Insucessos</h1>
          <Badge variant="secondary" className="ml-auto">
            {totalHoje} devolvidos hoje
          </Badge>
        </div>

        {!loteAberto ? (
          <div className="mb-4 rounded-md border bg-muted/30 p-4 flex items-center gap-4 flex-wrap">
            <div className="flex-1 min-w-[240px] text-sm text-muted-foreground">
              Nenhuma devolução aberta. Clique em <b>Criar devolução</b> para abrir um lote
              automático — o nome é gerado pelo sistema (base, data e sequência).
            </div>
            <Button
              size="lg"
              onClick={() => criarLote.mutate()}
              disabled={criarLote.isPending || !base || !diaOperacional}
            >
              <PackagePlus className="w-4 h-4 mr-2" />
              Criar devolução
            </Button>
          </div>
        ) : (
          <div className="mb-4 rounded-md border-2 border-[var(--brand-yellow)]/60 bg-muted/30 p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="min-w-[260px]">
                <div className="text-xs text-muted-foreground">Devolução atual (lote)</div>
                <div className="font-mono font-bold text-lg">{lote!.nome_exibicao}</div>
              </div>
              <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">
                Aberta
              </Badge>
              <Badge variant="secondary">{lote!.total_pacotes} pacotes</Badge>
              <Button
                variant="destructive"
                size="sm"
                className="ml-auto"
                onClick={() => finalizar.mutate()}
                disabled={finalizar.isPending}
              >
                Finalizar devolução
              </Button>
            </div>
            <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
              <span>
                Base: <b>{base?.codigo ?? "—"}</b>
              </span>
              <span>
                Data:{" "}
                <b className="font-mono">
                  {new Date(lote!.data_operacional + "T00:00:00").toLocaleDateString("pt-BR")}
                </b>
              </span>
              <span>
                Responsável: <b>{lote!.criado_por_nome ?? "—"}</b>
              </span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <ScanLine className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              autoFocus
              value={codigo}
              placeholder={
                loteAberto
                  ? "Bipe ou digite o tracking do pacote"
                  : "Crie uma devolução para liberar a bipagem"
              }
              disabled={!loteAberto || bipar.isPending}
              onChange={(e) => setCodigo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  registrarCodigo(codigo);
                }
              }}
              className="pl-9 h-12 text-lg font-mono"
            />
          </div>
          <Button
            size="lg"
            onClick={() => registrarCodigo(codigo)}
            disabled={!loteAberto || codigo.trim().length < 1 || bipar.isPending}
          >
            Registrar
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="lg" variant="outline">
                <Download className="w-4 h-4 mr-2" />
                Salvar/Imprimir
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={imprimir}>
                <Printer className="w-4 h-4 mr-2" /> Imprimir / Salvar PDF
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setRotaBusca("");
                  setRotaDialogOpen(true);
                }}
              >
                <Printer className="w-4 h-4 mr-2" /> Imprimir uma rota…
              </DropdownMenuItem>
              <DropdownMenuItem onClick={baixarCsv}>
                <Download className="w-4 h-4 mr-2" /> Baixar CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {ultimo?.status === "ok" && ultimo.devolucao && (
          <div className="mt-3 flex items-center gap-2 text-sm flex-wrap">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span className="font-mono">{ultimo.devolucao.shipment_codigo}</span>
            <Badge
              variant="outline"
              className={
                ultimo.devolucao.tratamento
                  ? CLASSE_TRATAMENTO[ultimo.devolucao.tratamento]
                  : undefined
              }
            >
              {ultimo.devolucao.motivo_descricao ?? "Motivo do Meli"}
            </Badge>
            {ultimo.devolucao.occurrence_code && (
              <span className="text-xs text-muted-foreground font-mono">
                {ultimo.devolucao.occurrence_code}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              Motivo definido automaticamente pela ocorrência do motorista no Meli.
            </span>
          </div>
        )}
        {ultimo && ultimo.status !== "ok" && ultimo.status !== "observacao_obrigatoria" && (
          <div
            className={`mt-3 flex items-center gap-2 text-sm ${
              ultimo.status === "duplicado"
                ? "text-amber-700 dark:text-amber-400"
                : "text-red-700 dark:text-red-400"
            }`}
          >
            {ultimo.status === "duplicado" ? (
              <AlertTriangle className="w-4 h-4" />
            ) : (
              <XCircle className="w-4 h-4" />
            )}
            <span>{ultimo.mensagem}</span>
          </div>
        )}
      </Card>

      <Card>
        <div className="p-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="font-semibold text-sm">
              {consultandoHoje ? "Devoluções do dia" : "Histórico de devoluções"}
            </h2>
            <Input
              type="date"
              value={diaAtivo ?? ""}
              onChange={(e) => setDiaHistorico(e.target.value || (diaOperacional ?? ""))}
              className="h-8 w-[160px]"
            />
            {!consultandoHoje && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDiaHistorico(diaOperacional ?? "")}
              >
                Voltar para hoje
              </Button>
            )}
          </div>
          <span className="text-xs text-muted-foreground">{lista.data?.length ?? 0} registros</span>
        </div>
        <div className="p-2 md:p-3">
          {lista.isLoading && (
            <div className="text-center text-sm text-muted-foreground py-6">Carregando…</div>
          )}
          {!lista.isLoading && grupos.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-6">
              Nenhuma devolução registrada{consultandoHoje ? " hoje" : " neste dia"}.
            </div>
          )}
          {!lista.isLoading && grupos.length > 0 && (
            <div className="space-y-2">
              {grupos.map((g) => {
                const expandido = expandidos.has(g.chave);
                return (
                  <div key={g.chave} className="border rounded-md overflow-hidden">
                    <div className="flex items-center gap-2 p-2 bg-muted/40 hover:bg-muted/60">
                      <button
                        type="button"
                        onClick={() => toggle(g.chave)}
                        className="flex items-center gap-2 flex-1 min-w-0 text-left"
                        aria-expanded={expandido}
                      >
                        {expandido ? (
                          <ChevronDown className="w-4 h-4 shrink-0" />
                        ) : (
                          <ChevronRight className="w-4 h-4 shrink-0" />
                        )}
                        <span className="font-mono font-semibold truncate">{g.label}</span>
                        <Badge variant="secondary" className="ml-1 shrink-0">
                          {g.linhas.length} {g.linhas.length === 1 ? "pacote" : "pacotes"}
                        </Badge>
                        {g.estado === "aberta" && (
                          <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 shrink-0">
                            Aberta
                          </Badge>
                        )}
                      </button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => imprimirLote(g)}
                        className="h-8 gap-1 text-xs"
                      >
                        <Printer className="w-3 h-3" /> Imprimir
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => baixarCSV(configLote(g))}
                        className="h-8 gap-1 text-xs"
                      >
                        <Download className="w-3 h-3" /> CSV
                      </Button>
                    </div>
                    {expandido && (
                      <div className="overflow-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-[90px]">Horário</TableHead>
                              <TableHead>Tracking</TableHead>
                              <TableHead>Rota</TableHead>
                              <TableHead>Motivo (Meli)</TableHead>
                              <TableHead>Tratamento</TableHead>
                              <TableHead>Operador</TableHead>
                              <TableHead className="w-12"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {g.linhas.map((d) => (
                              <TableRow key={d.id}>
                                <TableCell className="font-mono text-xs">
                                  {new Date(d.devolvido_em).toLocaleTimeString("pt-BR", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </TableCell>
                                <TableCell className="font-mono">{d.shipment_codigo}</TableCell>
                                <TableCell className="text-xs">{d.rota ?? "—"}</TableCell>
                                <TableCell className="text-xs">
                                  {d.motivo_descricao ??
                                    MOTIVOS.find((m) => m.value === d.motivo)?.label ??
                                    d.motivo}
                                  {d.occurrence_code && (
                                    <span className="ml-1 text-muted-foreground font-mono">
                                      ({d.occurrence_code})
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {d.tratamento && (
                                    <Badge
                                      variant="outline"
                                      className={
                                        CLASSE_TRATAMENTO[d.tratamento as TratamentoDevolucao]
                                      }
                                    >
                                      {LABEL_TRATAMENTO[d.tratamento as TratamentoDevolucao]}
                                    </Badge>
                                  )}
                                  {d.divergencia_delivered && (
                                    <Badge
                                      variant="outline"
                                      className="ml-1 bg-purple-600/20 text-purple-500 border-purple-600/40"
                                    >
                                      Meli entregue
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-xs">{d.operador_nome ?? "—"}</TableCell>
                                <TableCell>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => cancelar.mutate(d.id)}
                                    title="Cancelar devolução"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {/* Divergência crítica: Meli marca como entregue */}
      <Dialog open={!!divergencia} onOpenChange={(o) => !o && setDivergencia(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" /> Alerta crítico
            </DialogTitle>
            <DialogDescription>{divergencia?.mensagem}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="obs-div">Observação (obrigatória)</Label>
            <Textarea
              id="obs-div"
              value={obsDivergencia}
              onChange={(e) => setObsDivergencia(e.target.value)}
              placeholder="Descreva a condição do pacote recebido…"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDivergencia(null)}>
              Cancelar
            </Button>
            <Button
              disabled={obsDivergencia.trim().length < 3}
              onClick={() =>
                bipar.mutate({ codigo: divergencia!.codigo, observacao: obsDivergencia.trim() })
              }
            >
              Registrar com divergência
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resumo de finalização */}
      <Dialog open={!!resumoFinal} onOpenChange={(o) => !o && setResumoFinal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Devolução finalizada</DialogTitle>
            <DialogDescription className="font-mono">
              {resumoFinal?.lote?.nome_exibicao}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div>
              Total de pacotes: <b>{resumoFinal?.lote?.total_pacotes ?? 0}</b>
            </div>
            <div className="space-y-1">
              {(resumoFinal?.resumo ?? []).map((r) => (
                <div key={r.occurrence_code + r.motivo_descricao} className="flex justify-between">
                  <span>{r.motivo_descricao}</span>
                  <b>{r.total}</b>
                </div>
              ))}
            </div>
            <div className="max-h-40 overflow-auto rounded border p-2 font-mono text-xs">
              {(resumoFinal?.trackings ?? []).join(", ") || "—"}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                const g = grupos.find((x) => x.chave === resumoFinal?.lote?.id);
                if (g) baixarCSV(configLote(g));
              }}
            >
              <Download className="w-4 h-4 mr-2" /> CSV
            </Button>
            <Button
              onClick={() => {
                const g = grupos.find((x) => x.chave === resumoFinal?.lote?.id);
                if (g) imprimirLote(g);
              }}
            >
              <Printer className="w-4 h-4 mr-2" /> Imprimir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Imprimir uma rota */}
      <Dialog open={rotaDialogOpen} onOpenChange={setRotaDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Imprimir uma rota</DialogTitle>
            <DialogDescription>Escolha a rota para gerar o relatório.</DialogDescription>
          </DialogHeader>
          <Input
            value={rotaBusca}
            onChange={(e) => setRotaBusca(e.target.value)}
            placeholder="Buscar rota…"
            className="font-mono"
          />
          <div className="max-h-64 overflow-auto divide-y">
            {rotasFiltradas.map((r) => (
              <button
                key={r.label}
                type="button"
                className="w-full flex items-center justify-between py-2 text-sm hover:bg-muted/50 px-2"
                onClick={() => {
                  setRotaDialogOpen(false);
                  imprimirRota(r);
                }}
              >
                <span className="font-mono">{r.label}</span>
                <Badge variant="secondary">{r.total}</Badge>
              </button>
            ))}
            {rotasFiltradas.length === 0 && (
              <div className="py-4 text-center text-sm text-muted-foreground">
                Nenhuma rota encontrada.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
