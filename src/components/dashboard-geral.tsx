import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  meliDashboardOperacional,
  meliDashboardPacotesRota,
  type MeliDashboardRota,
  type MeliDashboardPmProgramada,
} from "@/lib/meli-dashboard.functions";
import { avisoPmProgramadas } from "@/lib/meli-pm";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SyncBaseIndicador, type SituacaoSync } from "@/components/meli-sync-monitor";
import { ChevronLeft, Search } from "lucide-react";


const CORES = ["var(--info)", "var(--success)", "var(--warning)", "var(--destructive)"] as const;

function nf(n: number | null | undefined) {
  return typeof n === "number" ? n.toLocaleString("pt-BR") : "—";
}

/**
 * Visão direta e imediata da operação: progresso por base + indicadores de entrega.
 */
export function DashboardGeral({
  data,
  syncPorCodigo,
}: {
  data: string;
  /** Situação real de sincronização por código de base (backend/worker). */
  syncPorCodigo?: Map<string, { situacao: SituacaoSync; minutos: number | null; status?: string | null }>;
}) {
  const fetchDados = useServerFn(meliDashboardOperacional);

  const filtros = useMemo(() => ({ data }), [data]);

  const q = useQuery({
    queryKey: ["dashboard-geral", filtros],
    queryFn: () => fetchDados({ data: filtros }),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });

  const d = q.data?.status === "ok" ? q.data : undefined;
  const bases = (d?.bases ?? []).slice().sort((a, b) => (a.base_codigo ?? "").localeCompare(b.base_codigo ?? ""));
  const c = d?.cards;

  const pmProgramadas = d?.pm_programadas ?? [];
  const [baseAberta, setBaseAberta] = useState<{ id: string | null; codigo: string; nome: string } | null>(null);
  const pmDaBase = useMemo(() => {
    if (!baseAberta) return [];
    return pmProgramadas.filter((r) =>
      baseAberta.id ? r.base_id === baseAberta.id : (r.base_codigo ?? "") === baseAberta.codigo,
    );
  }, [pmProgramadas, baseAberta]);
  const rotasDaBase = useMemo(() => {
    if (!baseAberta) return [];
    return (d?.rotas ?? [])
      .filter((r) =>
        baseAberta.id ? r.base_id === baseAberta.id : (r.base_codigo ?? "") === baseAberta.codigo,
      )
      .slice()
      .sort((a, b) => (a.nome_operacional ?? "").localeCompare(b.nome_operacional ?? ""));
  }, [d?.rotas, baseAberta]);

  return (
    <section className="space-y-4">
      <Card className="p-4 md:p-5">
        <h2 className="font-display text-xl md:text-2xl font-bold tracking-tight">Dashboard Geral</h2>
        <p className="text-xs text-muted-foreground">
          Progresso automático da operação — entregues sobre o total da base
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {bases.length === 0 && (
            <div className="col-span-full text-sm text-muted-foreground py-6 text-center">
              Nenhuma base com dados sincronizados para este dia.
            </div>
          )}
          {bases.map((b, i) => {
            const cor = CORES[i % CORES.length];
            const perc = Math.max(0, Math.min(100, Number(b.perc_entrega ?? 0)));
            return (
              <Card
                key={b.base_id ?? b.base_codigo ?? i}
                role="button"
                tabIndex={0}
                onClick={() =>
                  setBaseAberta({ id: b.base_id, codigo: b.base_codigo ?? "—", nome: b.base_nome ?? "—" })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setBaseAberta({ id: b.base_id, codigo: b.base_codigo ?? "—", nome: b.base_nome ?? "—" });
                  }
                }}
                className="relative overflow-hidden p-4 cursor-pointer transition-shadow hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ background: cor }} />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-bold" style={{ color: cor }}>
                      {b.base_codigo ?? "—"}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{b.base_nome ?? "—"}</div>
                  </div>
                  <div className="font-display text-2xl font-bold tabular-nums">{perc.toFixed(1)}%</div>
                </div>
                <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${perc}%`, background: cor }} />
                </div>
                <div className="mt-2">
                  {(() => {
                    const s = syncPorCodigo?.get(b.base_codigo ?? "");
                    return <SyncBaseIndicador situacao={s?.situacao ?? "sem_info"} minutos={s?.minutos ?? null} status={s?.status} />;
                  })()}
                </div>
                <div className="mt-2 grid grid-cols-3 text-center">
                  <MiniStat label="Rotas" value={nf(b.rotas)} />
                  <MiniStat label="Pacotes" value={nf(b.total)} />
                  <MiniStat label="Entregues" value={nf(b.entregue)} className="text-success" />
                </div>

                {(() => {
                  const aviso = avisoPmProgramadas(b.pm_nao_iniciadas ?? 0, b.pm_pacotes_fora ?? 0);
                  if (!aviso) return null;
                  return (
                    <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{aviso}</p>
                  );
                })()}
              </Card>
            );
          })}
        </div>
      </Card>

      <Card className="p-4 md:p-5">
        <h2 className="text-sm font-semibold">Indicadores de entrega</h2>
        <p className="text-xs text-muted-foreground">Posição atual das rotas ativas e falhas em tempo real.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <BigStat label="Carros em rota" value={nf(c?.rotas)} tone="info" />
          <BigStat label="Pacotes" value={nf(c?.total)} />
          <BigStat label="Entregues" value={nf(c?.entregue)} tone="success" />
          <BigStat label="Falhas" value={nf(c?.insucesso)} tone="destructive" />
        </div>
      </Card>

      <BaseDetalheDialog
        base={baseAberta}
        rotas={rotasDaBase}
        pmProgramadas={pmDaBase}
        onClose={() => setBaseAberta(null)}
      />
    </section>
  );
}

function pct(n: number | null | undefined) {
  return `${Math.max(0, Math.min(100, Number(n ?? 0))).toFixed(0)}%`;
}

function BaseDetalheDialog({
  base,
  rotas,
  pmProgramadas,
  onClose,
}: {
  base: { id: string | null; codigo: string; nome: string } | null;
  rotas: MeliDashboardRota[];
  pmProgramadas: MeliDashboardPmProgramada[];
  onClose: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [rotaSel, setRotaSel] = useState<MeliDashboardRota | null>(null);
  const fetchPacotes = useServerFn(meliDashboardPacotesRota);

  const pacotesQuery = useQuery({
    queryKey: ["dashboard-geral-pacotes", rotaSel?.rota_id],
    queryFn: () => fetchPacotes({ data: { rota_id: rotaSel!.rota_id, limit: 1000 } }),
    enabled: !!rotaSel,
  });

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return rotas;
    return rotas.filter((r) =>
      [r.nome_operacional, r.route_id, r.driver_name, r.vehicle_license]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(t)),
    );
  }, [rotas, busca]);

  const totais = useMemo(
    () =>
      rotas.reduce(
        (acc, r) => ({
          total: acc.total + (r.total ?? 0),
          entregue: acc.entregue + (r.entregue ?? 0),
          em_rota: acc.em_rota + (r.em_rota ?? 0),
          insucesso: acc.insucesso + (r.insucesso ?? 0),
        }),
        { total: 0, entregue: 0, em_rota: 0, insucesso: 0 },
      ),
    [rotas],
  );

  const pacotes = pacotesQuery.data?.status === "ok" ? (pacotesQuery.data.pacotes ?? []) : [];

  return (
    <Dialog
      open={!!base}
      onOpenChange={(o) => {
        if (!o) {
          setRotaSel(null);
          setBusca("");
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {rotaSel && (
              <Button variant="ghost" size="sm" onClick={() => setRotaSel(null)}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Rotas
              </Button>
            )}
            {base?.codigo} — {base?.nome}
            {rotaSel && <span className="text-muted-foreground">/ {rotaSel.nome_operacional}</span>}
          </DialogTitle>
        </DialogHeader>

        {!rotaSel ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <MiniBox label="Rotas" value={nf(rotas.length)} />
              <MiniBox label="Pacotes" value={nf(totais.total)} />
              <MiniBox label="Entregues" value={nf(totais.entregue)} tone="text-success" />
              <MiniBox label="Em rota" value={nf(totais.em_rota)} tone="text-[var(--info)]" />
              <MiniBox label="Falhas" value={nf(totais.insucesso)} tone="text-destructive" />
            </div>

            <h3 className="text-sm font-semibold">Rotas operacionais de hoje</h3>

            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Filtrar por rota, motorista ou placa..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>

            <ScrollArea className="h-[52vh]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 pr-2">Rota</th>
                    <th className="py-2 pr-2">Motorista</th>
                    <th className="py-2 pr-2">Placa</th>
                    <th className="py-2 pr-2 text-right">Pacotes</th>
                    <th className="py-2 pr-2 text-right">Entregues</th>
                    <th className="py-2 pr-2 text-right">Em rota</th>
                    <th className="py-2 pr-2 text-right">Falhas</th>
                    <th className="py-2 pr-2">Progresso</th>
                    <th className="py-2">Sincronizado</th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-6 text-center text-muted-foreground">
                        Nenhuma rota encontrada.
                      </td>
                    </tr>
                  )}
                  {filtradas.map((r) => (
                    <tr
                      key={r.rota_id}
                      className="border-t cursor-pointer hover:bg-muted/50"
                      onClick={() => setRotaSel(r)}
                    >
                      <td className="py-2 pr-2 font-medium">
                        {r.nome_operacional}
                        {r.rota_area_risco && (
                          <Badge variant="destructive" className="ml-2 text-[10px]">
                            risco
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-muted-foreground">{r.driver_name ?? "—"}</td>
                      <td className="py-2 pr-2 text-muted-foreground">{r.vehicle_license ?? "—"}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{nf(r.total)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums text-success">{nf(r.entregue)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{nf(r.em_rota)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums text-destructive">{nf(r.insucesso)}</td>
                      <td className="py-2 pr-2">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[var(--info)]"
                              style={{ width: pct(r.perc_entrega) }}
                            />
                          </div>
                          <span className="text-xs tabular-nums">{pct(r.perc_entrega)}</span>
                        </div>
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {r.last_synced_at ? new Date(r.last_synced_at).toLocaleString("pt-BR") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>

            {pmProgramadas.length > 0 && (
              <div className="rounded-md border border-dashed p-3">
                <h3 className="text-sm font-semibold">PM programadas para amanhã</h3>
                <p className="text-xs text-muted-foreground">
                  {avisoPmProgramadas(
                    pmProgramadas.length,
                    pmProgramadas.reduce((a, r) => a + (r.total ?? 0), 0),
                  )}
                </p>
                <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                  {pmProgramadas.map((r) => (
                    <li key={r.rota_id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate font-medium">{r.nome_operacional}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {nf(r.total)} pacotes
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <MiniBox label="Pacotes" value={nf(rotaSel.total)} />
              <MiniBox label="Entregues" value={nf(rotaSel.entregue)} tone="text-success" />
              <MiniBox label="Em rota" value={nf(rotaSel.em_rota)} tone="text-[var(--info)]" />
              <MiniBox label="Falhas" value={nf(rotaSel.insucesso)} tone="text-destructive" />
            </div>
            <ScrollArea className="h-[52vh]">
              {pacotesQuery.isLoading ? (
                <div className="py-8 text-center text-sm text-muted-foreground">Carregando pacotes...</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="py-2 pr-2">#</th>
                      <th className="py-2 pr-2">Tracking</th>
                      <th className="py-2 pr-2">Status de entrega</th>
                      <th className="py-2 pr-2">Ocorrência</th>
                      <th className="py-2">Atualizado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pacotes.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-muted-foreground">
                          Nenhum pacote nesta rota.
                        </td>
                      </tr>
                    )}
                    {pacotes.map((p) => (
                      <tr key={p.tracking_id} className="border-t">
                        <td className="py-2 pr-2 text-muted-foreground tabular-nums">{p.ordem ?? "—"}</td>
                        <td className="py-2 pr-2 font-mono text-xs">{p.tracking_id}</td>
                        <td className="py-2 pr-2">
                          <Badge variant="outline" className="text-[10px] uppercase">
                            {(p.situacao ?? "—").replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="py-2 pr-2 text-xs text-muted-foreground">
                          {p.descricao_ocorrencia ?? "—"}
                        </td>
                        <td className="py-2 text-xs text-muted-foreground">
                          {p.ultima_atualizacao_meli
                            ? new Date(p.ultima_atualizacao_meli).toLocaleString("pt-BR")
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MiniBox({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-display text-xl font-bold tabular-nums ${tone ?? ""}`}>{value}</div>
    </div>
  );
}


function MiniStat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <div className={`text-sm font-bold tabular-nums ${className ?? ""}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function BigStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "info" | "success" | "destructive";
}) {
  const cor =
    tone === "info" ? "var(--info)" : tone === "success" ? "var(--success)" : tone === "destructive" ? "var(--destructive)" : undefined;
  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <div className="text-[11px] uppercase tracking-wider font-semibold" style={cor ? { color: cor } : undefined}>
        {label}
      </div>
      <div className="font-display text-3xl md:text-4xl font-bold tabular-nums" style={cor ? { color: cor } : undefined}>
        {value}
      </div>
    </div>
  );
}
