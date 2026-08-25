import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { meliRankingMotoristas, type MeliRankingMotorista } from "@/lib/meli-ranking.functions";
import { descreverMotivo } from "@/lib/meli-status";
import { Card } from "@/components/ui/card";

const REFETCH_MS = 60_000;

function rotulo(codigo: string, descricao: string) {
  return descreverMotivo(codigo, descricao);
}

function dataBr(data?: string) {
  if (!data) return "—";
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano}`;
}

export function RankingMotoristasSection({
  data,
  baseId,
}: {
  data: string;
  baseId?: string | null;
}) {
  const fetchRanking = useServerFn(meliRankingMotoristas);
  const [aberto, setAberto] = useState<string | null>(null);

  const filtros = useMemo(
    () => ({ data, base_id: baseId ?? null, limite: 50 }),
    [data, baseId],
  );

  const q = useQuery({
    queryKey: ["meli-ranking-motoristas", filtros],
    queryFn: () => fetchRanking({ data: filtros }),
    refetchInterval: REFETCH_MS,
    placeholderData: (prev) => prev,
  });

  const motoristas = q.data?.status === "ok"
    ? (q.data.motoristas ?? []).filter((m) => {
        const nome = m.motorista?.trim().toLocaleLowerCase("pt-BR");
        return nome && nome !== "sem motorista informado" && nome !== "não identificado";
      })
    : [];

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b px-4 py-3">
        <h3 className="text-base font-semibold">Motoristas com mais falhas</h3>
        <p className="text-xs text-muted-foreground">
          Semana Meli · domingo a sábado
          {q.data?.periodo_inicio && q.data?.periodo_fim
            ? ` · ${dataBr(q.data.periodo_inicio)} a ${dataBr(q.data.periodo_fim)}`
            : ""}
        </p>
      </div>

      {q.isLoading && <p className="px-4 py-4 text-sm text-muted-foreground">Carregando…</p>}
      {q.data?.status === "erro" && (
        <p className="px-4 py-4 text-sm text-destructive">Não foi possível carregar: {q.data.erro}</p>
      )}
      {!q.isLoading && q.data?.status === "ok" && !motoristas.length && (
        <p className="px-4 py-4 text-sm text-muted-foreground">Nenhum insucesso registrado.</p>
      )}

      {motoristas.length > 0 && (
        <div className="max-h-[320px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pl-4 pr-2 font-medium">#</th>
                <th className="py-2 pr-2 font-medium">Motorista</th>
                <th className="py-2 pr-2 text-right font-medium">Estação</th>
                <th className="py-2 pr-2 text-right font-medium">Rotas</th>
                <th className="py-2 pr-4 text-right font-medium">Falhas</th>
              </tr>
            </thead>
            <tbody>
              {motoristas.map((m, i) => (
                <Linha
                  key={m.motorista}
                  posicao={i + 1}
                  m={m}
                  aberto={aberto === m.motorista}
                  onToggle={() => setAberto(aberto === m.motorista ? null : m.motorista)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Linha({
  posicao,
  m,
  aberto,
  onToggle,
}: {
  posicao: number;
  m: MeliRankingMotorista;
  aberto: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="cursor-pointer border-b transition hover:bg-muted/50" onClick={onToggle}>
        <td className="py-2.5 pl-4 pr-2 text-xs font-semibold text-muted-foreground">{posicao}º</td>
        <td className="py-2.5 pr-2 font-medium">{m.motorista || "Não identificado"}</td>
        <td className="py-2.5 pr-2 text-right text-xs text-muted-foreground">
          {m.bases.join(" / ") || "—"}
        </td>
        <td className="py-2.5 pr-2 text-right">{m.rotas}</td>
        <td className="py-2.5 pr-4 text-right font-bold text-destructive">
          {m.insucesso.toLocaleString("pt-BR")}
        </td>
      </tr>
      {aberto && (
        <tr className="border-b bg-muted/30">
          <td colSpan={5} className="px-4 py-3">
            <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              Ocorrências — {m.motorista} · {m.perc_insucesso}% de {m.total.toLocaleString("pt-BR")} pacotes
            </p>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {m.ocorrencias.map((o) => (
                <div
                  key={o.codigo}
                  className="flex items-center justify-between rounded border bg-background px-2 py-1.5 text-xs"
                >
                  <span>{rotulo(o.codigo, o.descricao)}</span>
                  <span className="font-semibold">{o.total}</span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
