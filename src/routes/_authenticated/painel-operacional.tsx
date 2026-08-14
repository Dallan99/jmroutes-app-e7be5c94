import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { rotasPorBase } from "@/lib/gerencial.functions";
import { BipagemBasesPanel } from "@/components/bipagem-bases";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { hojeOperacional } from "@/lib/dia-operacional";

export const Route = createFileRoute("/_authenticated/painel-operacional")({
  head: () => ({
    meta: [
      { title: "Painel Operacional — JM Transportes" },
      { name: "description", content: "Percentual de bipagem por base e acompanhamento das rotas do dia." },
      { property: "og:title", content: "Painel Operacional — JM Transportes" },
      { property: "og:description", content: "Percentual de bipagem por base e acompanhamento das rotas do dia." },
    ],
  }),
  component: PainelOperacionalPage,
});

function PainelOperacionalPage() {
  const [dia, setDia] = useState<string>(() => hojeOperacional());
  const [baseSel, setBaseSel] = useState<string | null>(null);

  const fetchRotas = useServerFn(rotasPorBase);
  const q = useQuery({
    queryKey: ["painel-operacional-rotas", dia],
    queryFn: () => fetchRotas({ data: { data: dia } }),
    refetchInterval: 30_000,
  });

  const bases = q.data?.bases ?? [];
  const rotas = useMemo(
    () => (q.data?.rotas ?? []).filter((r) => !baseSel || r.base_id === baseSel),
    [q.data, baseSel],
  );

  return (
    <div className="p-4 md:p-6 space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black tracking-tight">Painel Operacional</h1>
          <p className="text-sm text-muted-foreground">Percentual de bipagem por base no dia operacional.</p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <Label className="text-xs">Dia</Label>
            <Input type="date" value={dia} onChange={(e) => setDia(e.target.value)} className="h-9" />
          </div>
          <Button variant="outline" className="h-9" onClick={() => q.refetch()}>
            Atualizar
          </Button>
        </div>
      </header>

      <BipagemBasesPanel data={dia} />

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={baseSel ? "outline" : "default"} onClick={() => setBaseSel(null)}>
          Todas as bases
        </Button>
        {bases.map((b) => (
          <Button
            key={b.base_id}
            size="sm"
            variant={baseSel === b.base_id ? "default" : "outline"}
            onClick={() => setBaseSel(b.base_id)}
          >
            {b.codigo} · {b.pct.toFixed(0)}%
          </Button>
        ))}
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/70 backdrop-blur text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2">Base</th>
                <th className="text-left px-3 py-2">Rota</th>
                <th className="text-right px-3 py-2">Total</th>
                <th className="text-right px-3 py-2">Bipados</th>
                <th className="text-right px-3 py-2">Faltando</th>
                <th className="text-right px-3 py-2">% Bipagem</th>
                <th className="text-left px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rotas.map((r) => (
                <tr key={`${r.base_id}-${r.nro_rota}`} className="border-t">
                  <td className="px-3 py-1.5 font-medium">{r.base_codigo}</td>
                  <td className="px-3 py-1.5">{r.nro_rota}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.total}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.recebido}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.faltando}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{r.pct.toFixed(1)}%</td>
                  <td className="px-3 py-1.5 capitalize">{r.status}</td>
                </tr>
              ))}
              {rotas.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    {q.isLoading ? "Carregando…" : "Nenhuma rota para o filtro selecionado."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
