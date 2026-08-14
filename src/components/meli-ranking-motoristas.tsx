import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { meliRankingMotoristas, type MeliRankingMotorista } from "@/lib/meli-ranking.functions";
import { descreverMotivo } from "@/lib/meli-status";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronRight, Download, Trophy, UserX } from "lucide-react";

const REFETCH_MS = 60_000;

function rotulo(codigo: string, descricao: string) {
  return descreverMotivo(codigo, descricao);
}

export function MeliRankingMotoristasSection({
  data,
  baseId,
}: {
  data: string;
  baseId?: string | null;
}) {
  const fetchRanking = useServerFn(meliRankingMotoristas);
  const [busca, setBusca] = useState("");
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

  const res = q.data?.status === "ok" ? q.data : undefined;
  const termo = busca.trim().toLowerCase();
  const motoristas = (res?.motoristas ?? []).filter(
    (m) =>
      !termo ||
      m.motorista.toLowerCase().includes(termo) ||
      m.bases.some((b) => b.toLowerCase().includes(termo)) ||
      m.ocorrencias.some((o) => rotulo(o.codigo, o.descricao).toLowerCase().includes(termo)),
  );

  const baixarCsv = () => {
    const cab = ["Posicao", "Motorista", "Bases", "Rotas", "Pacotes", "Entregues", "Insucessos", "% Insucesso", "Ocorrencias"];
    const linhas = motoristas.map((m, i) => [
      i + 1,
      m.motorista,
      m.bases.join(" / "),
      m.rotas,
      m.total,
      m.entregue,
      m.insucesso,
      `${m.perc_insucesso}%`,
      m.ocorrencias.map((o) => `${rotulo(o.codigo, o.descricao)}: ${o.total}`).join(" | "),
    ]);
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = "\uFEFF" + [cab, ...linhas].map((l) => l.map(esc).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `ranking-motoristas-insucessos-${data}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const maxInsucesso = motoristas[0]?.insucesso ?? 0;

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          <Trophy className="h-4 w-4 text-[var(--warning)]" aria-hidden />
          Ranking de motoristas — maiores ofensores em insucessos
        </h3>
        <div className="flex items-center gap-2">
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Motorista, base ou ocorrência"
            className="h-8 w-56"
            aria-label="Buscar no ranking de motoristas"
          />
          <Button size="sm" variant="outline" onClick={baixarCsv} disabled={!motoristas.length}>
            <Download className="mr-1 h-4 w-4" aria-hidden /> CSV
          </Button>
        </div>
      </div>

      {q.isLoading && <p className="text-sm text-muted-foreground">Carregando ranking…</p>}
      {q.data?.status === "erro" && (
        <p className="text-sm text-destructive">Não foi possível carregar o ranking: {q.data.erro}</p>
      )}

      {!q.isLoading && !motoristas.length && q.data?.status === "ok" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <UserX className="h-4 w-4" aria-hidden /> Nenhum insucesso registrado nos filtros atuais.
        </p>
      )}

      {(res?.ocorrencias_gerais?.length ?? 0) > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {res!.ocorrencias_gerais!.slice(0, 8).map((o) => (
            <Badge key={o.codigo} variant="outline" className="text-[11px]">
              {rotulo(o.codigo, o.descricao)} · {o.total}
            </Badge>
          ))}
          <Badge variant="secondary" className="text-[11px]">
            Total de insucessos: {(res?.total_insucessos ?? 0).toLocaleString("pt-BR")}
          </Badge>
        </div>
      )}

      {motoristas.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-2">#</th>
                <th className="py-2 pr-2">Motorista</th>
                <th className="py-2 pr-2">Bases</th>
                <th className="py-2 pr-2 text-right">Rotas</th>
                <th className="py-2 pr-2 text-right">Pacotes</th>
                <th className="py-2 pr-2 text-right">Entregues</th>
                <th className="py-2 pr-2 text-right">Insucessos</th>
                <th className="py-2 pr-2 text-right">% Insucesso</th>
                <th className="py-2 pr-2">Ocorrência principal</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {motoristas.map((m, i) => (
                <LinhaMotorista
                  key={m.motorista}
                  posicao={i + 1}
                  m={m}
                  maxInsucesso={maxInsucesso}
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

function LinhaMotorista({
  posicao,
  m,
  maxInsucesso,
  aberto,
  onToggle,
}: {
  posicao: number;
  m: MeliRankingMotorista;
  maxInsucesso: number;
  aberto: boolean;
  onToggle: () => void;
}) {
  const principal = m.ocorrencias[0];
  const largura = maxInsucesso > 0 ? Math.max(4, Math.round((m.insucesso / maxInsucesso) * 100)) : 0;
  return (
    <>
      <tr className="cursor-pointer border-b transition hover:bg-muted/50" onClick={onToggle}>
        <td className="py-2 pr-2 font-semibold text-muted-foreground">{posicao}</td>
        <td className="py-2 pr-2 font-medium">{m.motorista}</td>
        <td className="py-2 pr-2 text-xs text-muted-foreground">{m.bases.join(" / ") || "—"}</td>
        <td className="py-2 pr-2 text-right">{m.rotas}</td>
        <td className="py-2 pr-2 text-right">{m.total.toLocaleString("pt-BR")}</td>
        <td className="py-2 pr-2 text-right">{m.entregue.toLocaleString("pt-BR")}</td>
        <td className="py-2 pr-2 text-right font-semibold text-[var(--warning)]">
          <span className="inline-flex items-center gap-2">
            <span
              className="hidden h-1.5 rounded bg-[var(--warning)] sm:inline-block"
              style={{ width: `${largura}px` }}
              aria-hidden
            />
            {m.insucesso.toLocaleString("pt-BR")}
          </span>
        </td>
        <td className="py-2 pr-2 text-right">{m.perc_insucesso}%</td>
        <td className="py-2 pr-2 text-xs">
          {principal ? `${rotulo(principal.codigo, principal.descricao)} (${principal.total})` : "—"}
        </td>
        <td className="py-2 text-right text-muted-foreground">
          {aberto ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
        </td>
      </tr>
      {aberto && (
        <tr className="border-b bg-muted/30">
          <td colSpan={10} className="px-2 py-3">
            <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              Ocorrências registradas — {m.motorista}
            </p>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {m.ocorrencias.map((o) => (
                <div key={o.codigo} className="flex items-center justify-between rounded border bg-background px-2 py-1.5 text-xs">
                  <span>
                    {rotulo(o.codigo, o.descricao)}
                    <span className="ml-1 text-muted-foreground">({o.codigo})</span>
                  </span>
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
