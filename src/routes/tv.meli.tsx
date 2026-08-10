import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  meliDashboardOperacional,
  type MeliDashboardFiltros,
  type MeliDashboardRota,
} from "@/lib/meli-dashboard.functions";
import { LABEL_SITUACAO, descreverMotivo, type SituacaoMeli } from "@/lib/meli-status";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle, ChevronLeft, ChevronRight, Pause, Play, ShieldAlert,
} from "lucide-react";

type Risco = "qualquer" | "integral" | "parcial";

type Busca = {
  data?: string;
  base_id?: string;
  motorista?: string;
  rota?: string;
  status?: SituacaoMeli;
  transportadora?: string;
  risco?: Risco;
};

const SITUACOES: SituacaoMeli[] = [
  "nao_iniciado", "em_rota", "entregue", "insucesso", "cancelado", "desconhecido",
];
const RISCOS: Risco[] = ["qualquer", "integral", "parcial"];

export const Route = createFileRoute("/tv/meli")({
  head: () => ({
    meta: [
      { title: "Modo TV — Operação Meli | JMRoutes" },
      { name: "description", content: "Painel de televisão da operação Meli em tempo real: rotas, entregas, insucessos e área de risco." },
      { property: "og:title", content: "Modo TV — Operação Meli | JMRoutes" },
      { property: "og:description", content: "Painel de televisão da operação Meli em tempo real." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): Busca => ({
    data: typeof s.data === "string" ? s.data : undefined,
    base_id: typeof s.base_id === "string" ? s.base_id : undefined,
    motorista: typeof s.motorista === "string" ? s.motorista : undefined,
    rota: typeof s.rota === "string" ? s.rota : undefined,
    status: SITUACOES.includes(s.status as SituacaoMeli) ? (s.status as SituacaoMeli) : undefined,
    transportadora: typeof s.transportadora === "string" ? s.transportadora : undefined,
    risco: RISCOS.includes(s.risco as Risco) ? (s.risco as Risco) : undefined,
  }),
  component: TvMeli,
});

const REFETCH_MS = 30_000;
const SEM_SYNC_MS = 2 * 60_000;
const ROTA_PARADA_MS = 15 * 60_000;
const PAGINA_MS = 10_000;
const LINHAS_POR_PAGINA = 10;
const PREF_KEY = "jmroutes.tv.meli.prefs";

type Visao = "resumo" | "rotas" | "insucessos" | "risco" | "bases";
const VISOES: { id: Visao; label: string }[] = [
  { id: "resumo", label: "Resumo geral" },
  { id: "rotas", label: "Operações / rotas" },
  { id: "insucessos", label: "Insucessos" },
  { id: "risco", label: "Área de risco" },
  { id: "bases", label: "Bases" },
];

type Prefs = {
  baseId: string | null;
  somenteAtencao: boolean;
  situacao: SituacaoMeli | null;
  rotacaoVisoes: boolean;
};

function hhmmss(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function lerPrefs(inicial: Prefs): Prefs {
  if (typeof window === "undefined") return inicial;
  try {
    const raw = window.localStorage.getItem(PREF_KEY);
    if (!raw) return inicial;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      baseId: typeof p.baseId === "string" ? p.baseId : inicial.baseId,
      somenteAtencao: !!p.somenteAtencao,
      situacao: SITUACOES.includes(p.situacao as SituacaoMeli) ? (p.situacao as SituacaoMeli) : inicial.situacao,
      rotacaoVisoes: !!p.rotacaoVisoes,
    };
  } catch {
    return inicial;
  }
}

function TvMeli() {
  const busca = Route.useSearch();
  const fetchDados = useServerFn(meliDashboardOperacional);

  const [prefs, setPrefs] = useState<Prefs>(() =>
    lerPrefs({
      baseId: busca.base_id ?? null,
      somenteAtencao: false,
      situacao: busca.status ?? null,
      rotacaoVisoes: false,
    }),
  );
  const [visao, setVisao] = useState<Visao>("resumo");
  const [pagina, setPagina] = useState(0);
  const [pausado, setPausado] = useState(false);
  const [segundos, setSegundos] = useState(REFETCH_MS / 1000);
  const retomarRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    } catch { /* preferências são opcionais */ }
  }, [prefs]);

  const filtros = useMemo<MeliDashboardFiltros>(
    () => ({
      data: busca.data ?? null,
      base_id: prefs.baseId,
      motorista: busca.motorista ?? null,
      rota: busca.rota ?? null,
      status: prefs.situacao,
      transportadora: busca.transportadora ?? null,
      risco: busca.risco ?? null,
    }),
    [busca, prefs.baseId, prefs.situacao],
  );

  const q = useQuery({
    queryKey: ["tv-meli", filtros],
    queryFn: () => fetchDados({ data: filtros }),
    refetchInterval: REFETCH_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });

  useEffect(() => {
    setSegundos(REFETCH_MS / 1000);
    const t = setInterval(() => setSegundos((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [q.dataUpdatedAt]);

  const d = q.data?.status === "ok" ? q.data : undefined;
  const cards = d?.cards;
  const rotas = d?.rotas ?? [];
  const serverTime = d?.server_time ?? null;
  const agora = serverTime ? new Date(serverTime).getTime() : Date.now();
  const ultimaSync = d?.ultima_sincronizacao ?? null;
  const syncAtrasada = !ultimaSync || agora - new Date(ultimaSync).getTime() > SEM_SYNC_MS;

  const precisaAtencao = useCallback(
    (r: MeliDashboardRota) =>
      (!r.last_synced_at || agora - new Date(r.last_synced_at).getTime() > ROTA_PARADA_MS) ||
      r.rota_area_risco || r.area_risco_parcial ||
      (r.total > 0 && r.insucesso / r.total > 0.2) ||
      (r.total > 0 && r.nao_iniciado / r.total > 0.8) ||
      ((r.rota_area_risco || r.area_risco_parcial) && r.perc_entrega < 50),
    [agora],
  );

  const rotasOrdenadas = useMemo(() => {
    const base = prefs.somenteAtencao ? rotas.filter(precisaAtencao) : rotas;
    const atraso = (r: MeliDashboardRota) =>
      !r.last_synced_at ? Number.MAX_SAFE_INTEGER : agora - new Date(r.last_synced_at).getTime();
    return [...base].sort((a, b) => {
      const aAtraso = atraso(a) > ROTA_PARADA_MS ? 1 : 0;
      const bAtraso = atraso(b) > ROTA_PARADA_MS ? 1 : 0;
      if (aAtraso !== bAtraso) return bAtraso - aAtraso;
      const aRisco = a.rota_area_risco || a.area_risco_parcial ? 1 : 0;
      const bRisco = b.rota_area_risco || b.area_risco_parcial ? 1 : 0;
      if (aRisco !== bRisco) return bRisco - aRisco;
      if (b.insucesso !== a.insucesso) return b.insucesso - a.insucesso;
      if (a.perc_entrega !== b.perc_entrega) return a.perc_entrega - b.perc_entrega;
      return b.nao_iniciado - a.nao_iniciado;
    });
  }, [rotas, prefs.somenteAtencao, precisaAtencao, agora]);

  const totalPaginas = Math.max(1, Math.ceil(rotasOrdenadas.length / LINHAS_POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas - 1);
  const linhas = rotasOrdenadas.slice(paginaAtual * LINHAS_POR_PAGINA, (paginaAtual + 1) * LINHAS_POR_PAGINA);

  // Rotação automática de páginas e de visões
  useEffect(() => {
    if (pausado) return;
    const id = setInterval(() => {
      setPagina((p) => {
        const prox = p + 1;
        if (prox < totalPaginas) return prox;
        if (prefs.rotacaoVisoes) {
          setVisao((v) => {
            const i = VISOES.findIndex((x) => x.id === v);
            return VISOES[(i + 1) % VISOES.length]!.id;
          });
        }
        return 0;
      });
    }, PAGINA_MS);
    return () => clearInterval(id);
  }, [pausado, totalPaginas, prefs.rotacaoVisoes]);

  // Pausa temporária ao interagir e retomada automática
  const interagiu = useCallback(() => {
    setPausado(true);
    if (retomarRef.current) window.clearTimeout(retomarRef.current);
    retomarRef.current = window.setTimeout(() => setPausado(false), 30_000);
  }, []);

  const alertas = useMemo(() => {
    const out: string[] = [];
    if (syncAtrasada) out.push("Sem sincronização Meli há mais de 2 minutos.");
    for (const r of rotasOrdenadas) {
      if (!r.last_synced_at || agora - new Date(r.last_synced_at).getTime() > ROTA_PARADA_MS) {
        out.push(`${r.nome_operacional}: rota sem atualização há mais de 15 minutos.`);
      }
      if (r.total > 0 && r.insucesso / r.total > 0.2) {
        out.push(`${r.nome_operacional}: insucesso acima de 20%.`);
      }
      if (r.total > 0 && r.nao_iniciado / r.total > 0.8) {
        out.push(`${r.nome_operacional}: mais de 80% não iniciados.`);
      }
      if ((r.rota_area_risco || r.area_risco_parcial) && r.perc_entrega < 50) {
        out.push(`${r.nome_operacional}: área de risco com evolução abaixo de 50%.`);
      }
    }
    return Array.from(new Set(out)).slice(0, 6);
  }, [rotasOrdenadas, syncAtrasada, agora]);

  const bases = d?.bases ?? [];

  return (
    <div
      className="space-y-5 p-5 xl:p-8"
      onPointerDown={interagiu}
      onKeyDown={interagiu}
    >
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-black tracking-tight xl:text-5xl">Operação Meli — Modo TV</h1>
          <p className="mt-1 text-base text-white/70 xl:text-lg">
            Dia operacional <span className="font-semibold tabular-nums">{d?.data_operacional ?? busca.data ?? "—"}</span>
            {" · "}Base{" "}
            <span className="font-semibold">
              {prefs.baseId ? (bases.find((b) => b.base_id === prefs.baseId)?.base_codigo ?? "selecionada") : "Todas"}
            </span>
            {" · "}Últ. sync Meli <span className="font-semibold tabular-nums">{hhmmss(ultimaSync)}</span>
            {" · "}Próxima atualização em <span className="tabular-nums">{segundos}s</span>
            {q.isFetching && <span className="ml-2 text-sm opacity-70">Atualizando…</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Base exibida no Modo TV"
            className="rounded-md border border-white/20 bg-white/10 px-3 py-2 text-sm"
            value={prefs.baseId ?? "all"}
            onChange={(e) => setPrefs((p) => ({ ...p, baseId: e.target.value === "all" ? null : e.target.value }))}
          >
            <option value="all">Todas as bases</option>
            {bases.filter((b) => b.base_id).map((b) => (
              <option key={b.base_id!} value={b.base_id!}>{b.base_codigo ?? "—"}</option>
            ))}
          </select>
          <select
            aria-label="Situação Meli exibida no Modo TV"
            className="rounded-md border border-white/20 bg-white/10 px-3 py-2 text-sm"
            value={prefs.situacao ?? "all"}
            onChange={(e) => setPrefs((p) => ({ ...p, situacao: e.target.value === "all" ? null : (e.target.value as SituacaoMeli) }))}
          >
            <option value="all">Todas as situações</option>
            {SITUACOES.map((s) => <option key={s} value={s}>{LABEL_SITUACAO[s]}</option>)}
          </select>
          <Button
            size="sm"
            variant="ghost"
            className="text-white hover:bg-white/10 hover:text-white"
            onClick={() => setPrefs((p) => ({ ...p, somenteAtencao: !p.somenteAtencao }))}
          >
            {prefs.somenteAtencao ? "Todas as rotas" : "Somente atenção"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-white hover:bg-white/10 hover:text-white"
            onClick={() => setPrefs((p) => ({ ...p, rotacaoVisoes: !p.rotacaoVisoes }))}
          >
            {prefs.rotacaoVisoes ? "Fixar visão" : "Rodar visões"}
          </Button>
        </div>
      </header>

      {(syncAtrasada || q.data?.status === "erro") && (
        <div role="alert" className="flex items-center gap-3 rounded-xl border-2 border-rose-500 bg-rose-500/15 p-4 text-lg font-semibold">
          <AlertTriangle className="h-7 w-7 shrink-0 text-rose-400" aria-hidden />
          {q.data?.status === "erro"
            ? `Falha na atualização do painel: ${q.data.erro}. Exibindo os últimos dados válidos.`
            : "Integração Meli sem sincronização há mais de 2 minutos."}
        </div>
      )}

      <nav className="flex flex-wrap gap-2" aria-label="Visões do Modo TV">
        {VISOES.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => { setVisao(v.id); setPagina(0); }}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              visao === v.id ? "bg-[var(--brand-yellow)] text-[var(--brand-navy)]" : "bg-white/10 text-white/70 hover:text-white"
            }`}
          >
            {v.label}
          </button>
        ))}
      </nav>

      {visao === "resumo" && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6">
          <TvNum label="Total de pacotes" valor={cards?.total} />
          <TvNum label="Não iniciados" valor={cards?.nao_iniciado} tom="neutro" />
          <TvNum label="Em rota" valor={cards?.em_rota} tom="info" />
          <TvNum label="Entregues" valor={cards?.entregue} tom="ok" />
          <TvNum label="Insucessos" valor={cards?.insucesso} tom="atencao" />
          <TvNum label="Cancelados" valor={cards?.cancelado} tom="neutro" />
          <TvNum label="% Entrega" valor={cards ? `${cards.perc_entrega}%` : undefined} tom="ok" />
          <TvNum label="Rotas" valor={cards?.rotas} />
          <TvNum label="Rotas em risco" valor={cards?.rotas_risco} tom="critico" />
          <TvNum label="Pacotes em risco" valor={cards?.area_risco_pacotes} tom="critico" />
          <TvNum label="Sincronização" valor={syncAtrasada ? "Atrasada" : "Em dia"} tom={syncAtrasada ? "critico" : "ok"} />
          <TvNum label="Alertas" valor={alertas.length} tom={alertas.length ? "atencao" : "ok"} />
        </div>
      )}

      {visao === "rotas" && (
        <TvCard
          titulo={`Operações / rotas (${rotasOrdenadas.length})`}
          rodape={
            <Paginacao
              pagina={paginaAtual}
              total={totalPaginas}
              pausado={pausado}
              onAnterior={() => { interagiu(); setPagina((p) => (p - 1 + totalPaginas) % totalPaginas); }}
              onProxima={() => { interagiu(); setPagina((p) => (p + 1) % totalPaginas); }}
              onPausar={() => setPausado((p) => !p)}
            />
          }
        >
          <table className="w-full text-base xl:text-lg">
            <thead>
              <tr className="border-b border-white/15 text-left text-sm uppercase tracking-wider text-white/60">
                <th className="p-2">Rota / cluster</th>
                <th className="p-2">Motorista</th>
                <th className="p-2">Placa</th>
                <th className="p-2">Total</th>
                <th className="p-2">Não inic.</th>
                <th className="p-2">Em rota</th>
                <th className="p-2">Entregues</th>
                <th className="p-2">Insuc.</th>
                <th className="p-2">% Entrega</th>
                <th className="p-2">Risco</th>
                <th className="p-2">Últ. sync</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((r) => {
                const atrasada = !r.last_synced_at || agora - new Date(r.last_synced_at).getTime() > ROTA_PARADA_MS;
                return (
                  <tr key={r.rota_id} className={`border-b border-white/10 ${atrasada ? "bg-rose-500/10" : ""}`}>
                    <td className="p-2 font-semibold">
                      {r.nome_operacional}
                      <span className="ml-2 text-xs font-normal text-white/50">{r.base_codigo ?? "—"}</span>
                    </td>
                    <td className="p-2">{r.driver_name ?? "—"}</td>
                    <td className="p-2">{r.vehicle_license ?? "—"}</td>
                    <td className="p-2 tabular-nums">{r.total}</td>
                    <td className="p-2 tabular-nums text-white/60">{r.nao_iniciado}</td>
                    <td className="p-2 tabular-nums text-sky-300">{r.em_rota}</td>
                    <td className="p-2 tabular-nums text-emerald-400">{r.entregue}</td>
                    <td className="p-2 tabular-nums text-amber-300">{r.insucesso}</td>
                    <td className="p-2 tabular-nums font-semibold">{r.perc_entrega}%</td>
                    <td className="p-2">
                      {r.rota_area_risco || r.area_risco_parcial ? (
                        <span className="inline-flex items-center gap-1 rounded bg-rose-500/20 px-2 py-0.5 text-sm text-rose-300">
                          <ShieldAlert className="h-4 w-4" aria-hidden />
                          {r.rota_area_risco ? "Integral" : "Parcial"}
                        </span>
                      ) : "—"}
                    </td>
                    <td className={`p-2 tabular-nums ${atrasada ? "text-rose-300 font-semibold" : ""}`}>{hhmmss(r.last_synced_at)}</td>
                  </tr>
                );
              })}
              {linhas.length === 0 && (
                <tr><td colSpan={11} className="p-6 text-center text-white/60">Nenhuma rota para os filtros atuais.</td></tr>
              )}
            </tbody>
          </table>
        </TvCard>
      )}

      {visao === "insucessos" && (
        <TvCard titulo="Insucessos e motivos">
          <div className="grid gap-3 md:grid-cols-2">
            {(d?.motivos_insucesso ?? []).slice(0, 12).map((m) => (
              <div key={m.codigo} className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-3">
                <span className="text-lg">{descreverMotivo(m.codigo, m.descricao)}</span>
                <span className="font-display text-2xl font-black tabular-nums text-amber-300">{m.total}</span>
              </div>
            ))}
            {(d?.motivos_insucesso ?? []).length === 0 && (
              <p className="text-white/60">Nenhum insucesso registrado.</p>
            )}
          </div>
        </TvCard>
      )}

      {visao === "risco" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <TvNum label="Rotas em risco" valor={d?.area_risco?.rotas} tom="critico" />
            <TvNum label="Integrais" valor={d?.area_risco?.integrais} tom="critico" />
            <TvNum label="Parciais" valor={d?.area_risco?.parciais} tom="atencao" />
            <TvNum label="Pacotes em risco" valor={d?.area_risco?.pacotes} tom="critico" />
            <TvNum label="Entregues" valor={d?.area_risco?.entregue} tom="ok" />
            <TvNum label="Em rota" valor={d?.area_risco?.em_rota} tom="info" />
            <TvNum label="Insucessos" valor={d?.area_risco?.insucesso} tom="atencao" />
            <TvNum label="% Conclusão" valor={d?.area_risco ? `${d.area_risco.perc_conclusao}%` : undefined} tom="ok" />
          </div>
          <TvCard titulo="Rotas de área de risco">
            <ul className="space-y-2 text-lg">
              {rotas.filter((r) => r.rota_area_risco || r.area_risco_parcial).slice(0, 12).map((r) => (
                <li key={r.rota_id} className="flex items-center justify-between rounded bg-white/5 px-4 py-2">
                  <span>{r.nome_operacional} <span className="text-white/50">· {r.base_codigo ?? "—"}</span></span>
                  <span className="tabular-nums">{r.pacotes_risco} pacotes · {r.perc_entrega}%</span>
                </li>
              ))}
              {rotas.every((r) => !r.rota_area_risco && !r.area_risco_parcial) && (
                <li className="text-white/60">Nenhuma rota de área de risco.</li>
              )}
            </ul>
          </TvCard>
        </div>
      )}

      {visao === "bases" && (
        <TvCard titulo="Comparação entre bases">
          <table className="w-full text-base xl:text-lg">
            <thead>
              <tr className="border-b border-white/15 text-left text-sm uppercase tracking-wider text-white/60">
                <th className="p-2">Base</th>
                <th className="p-2">Rotas</th>
                <th className="p-2">Rotas risco</th>
                <th className="p-2">Total</th>
                <th className="p-2">Entregues</th>
                <th className="p-2">Em rota</th>
                <th className="p-2">Insucessos</th>
                <th className="p-2">% Entrega</th>
              </tr>
            </thead>
            <tbody>
              {bases.map((b) => (
                <tr key={b.base_id ?? b.base_codigo ?? "sem"} className="border-b border-white/10">
                  <td className="p-2 font-semibold">{b.base_codigo ?? "—"}</td>
                  <td className="p-2 tabular-nums">{b.rotas}</td>
                  <td className="p-2 tabular-nums text-rose-300">{b.rotas_risco}</td>
                  <td className="p-2 tabular-nums">{b.total}</td>
                  <td className="p-2 tabular-nums text-emerald-400">{b.entregue}</td>
                  <td className="p-2 tabular-nums text-sky-300">{b.em_rota}</td>
                  <td className="p-2 tabular-nums text-amber-300">{b.insucesso}</td>
                  <td className="p-2 tabular-nums font-semibold">{b.perc_entrega}%</td>
                </tr>
              ))}
              {bases.length === 0 && (
                <tr><td colSpan={8} className="p-6 text-center text-white/60">Sem dados de bases.</td></tr>
              )}
            </tbody>
          </table>
        </TvCard>
      )}

      {alertas.length > 0 && (
        <TvCard titulo="Alertas operacionais">
          <ul className="space-y-1 text-lg">
            {alertas.map((a) => (
              <li key={a} className="flex items-start gap-2">
                <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-amber-300" aria-hidden />
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </TvCard>
      )}

      {q.isPending && !d && <p className="text-white/60">Carregando dados da operação…</p>}
    </div>
  );
}

function Paginacao({
  pagina, total, pausado, onAnterior, onProxima, onPausar,
}: {
  pagina: number; total: number; pausado: boolean;
  onAnterior: () => void; onProxima: () => void; onPausar: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-white/70">
      <span className="tabular-nums">Página {pagina + 1} de {total}</span>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" aria-label="Página anterior" className="text-white hover:bg-white/10 hover:text-white" onClick={onAnterior}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" aria-label={pausado ? "Retomar rotação" : "Pausar rotação"} className="text-white hover:bg-white/10 hover:text-white" onClick={onPausar}>
          {pausado ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </Button>
        <Button size="sm" variant="ghost" aria-label="Próxima página" className="text-white hover:bg-white/10 hover:text-white" onClick={onProxima}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function TvCard({ titulo, children, rodape }: { titulo: string; children: React.ReactNode; rodape?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-white/70">{titulo}</h2>
      <div className="overflow-x-auto">{children}</div>
      {rodape && <div className="mt-3 border-t border-white/10 pt-3">{rodape}</div>}
    </div>
  );
}

function TvNum({
  label, valor, tom,
}: {
  label: string;
  valor: number | string | undefined;
  tom?: "ok" | "info" | "atencao" | "critico" | "neutro";
}) {
  const cor =
    tom === "ok" ? "text-emerald-400"
    : tom === "info" ? "text-sky-300"
    : tom === "atencao" ? "text-amber-300"
    : tom === "critico" ? "text-rose-400"
    : tom === "neutro" ? "text-white/60"
    : "text-[var(--brand-yellow)]";
  return (
    <div className={`rounded-2xl border p-5 xl:p-6 ${tom === "critico" ? "border-rose-500/50 bg-rose-500/10" : "border-white/10 bg-white/[0.06]"}`}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-white/60 xl:text-sm">{label}</p>
      <p className={`font-display text-4xl font-black tabular-nums xl:text-6xl ${cor}`}>{valor ?? "—"}</p>
    </div>
  );
}
