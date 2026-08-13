import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  meliDashboardOperacional,
  meliDashboardPacotesRota,
  type MeliDashboardRota,
} from "@/lib/meli-dashboard.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronLeft, Search } from "lucide-react";

const CORES = ["var(--info)", "var(--success)", "var(--warning)", "var(--destructive)"] as const;

function nf(n: number | null | undefined) {
  return typeof n === "number" ? n.toLocaleString("pt-BR") : "—";
}

/**
 * Visão direta e imediata da operação: progresso por base + indicadores de entrega.
 */
export function DashboardGeral({ data }: { data: string }) {
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

  const [baseAberta, setBaseAberta] = useState<{ id: string | null; codigo: string; nome: string } | null>(null);
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
              <Card key={b.base_id ?? b.base_codigo ?? i} className="relative overflow-hidden p-4">
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
                <div className="mt-3 grid grid-cols-3 text-center">
                  <MiniStat label="Rotas" value={nf(b.rotas)} />
                  <MiniStat label="Pacotes" value={nf(b.total)} />
                  <MiniStat label="Entregues" value={nf(b.entregue)} className="text-success" />
                </div>
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
    </section>
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
