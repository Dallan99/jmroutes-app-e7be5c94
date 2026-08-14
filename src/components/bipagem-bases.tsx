import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { rotasPorBase } from "@/lib/gerencial.functions";

type Props = {
  /** Dia operacional (YYYY-MM-DD). Vazio = dia atual resolvido no servidor. */
  data?: string | null;
  /** Layout ampliado para telões (Modo TV). */
  tv?: boolean;
  refetchInterval?: number;
  titulo?: string;
};

function tone(pct: number) {
  if (pct >= 99) return "var(--success)";
  if (pct >= 70) return "var(--info)";
  if (pct >= 30) return "var(--warning)";
  return "var(--destructive)";
}

/**
 * Percentual de bipagem (recebimento) por base no dia operacional.
 * Usado no Painel Operacional, no Dashboard e no Modo TV.
 */
export function BipagemBasesPanel({ data, tv = false, refetchInterval = 30_000, titulo = "Bipagem por base" }: Props) {
  const fetchRotas = useServerFn(rotasPorBase);
  const q = useQuery({
    queryKey: ["bipagem-bases", data ?? "auto"],
    queryFn: () => fetchRotas({ data: data ? { data } : {} }),
    refetchInterval,
  });

  // O usuário solicitou que apareçam todas as bases, mesmo as sem pacotes
  const bases = q.data?.bases ?? [];
  const total = bases.reduce((s, b) => s + b.total_pacotes, 0);
  const recebidos = bases.reduce((s, b) => s + b.recebidos, 0);
  const pctGeral = total ? (recebidos / total) * 100 : 0;

  return (
    <section
      className={
        tv
          ? "rounded-2xl border border-white/10 bg-white/5 p-5"
          : "rounded-2xl border bg-card p-4 shadow-sm"
      }
    >
      <header className="flex items-end justify-between gap-3 mb-3">
        <div>
          <h2 className={tv ? "font-display text-2xl font-bold" : "font-display text-lg font-bold"}>{titulo}</h2>
          <p className={tv ? "text-white/60 text-sm" : "text-muted-foreground text-xs"}>
            {q.data?.data ? `Dia operacional ${q.data.data}` : "Carregando dia operacional…"} · {recebidos.toLocaleString("pt-BR")} de{" "}
            {total.toLocaleString("pt-BR")} pacotes bipados
          </p>
        </div>
        <div
          className={tv ? "font-display text-4xl font-black tabular-nums" : "font-display text-2xl font-black tabular-nums"}
          style={{ color: tone(pctGeral) }}
        >
          {pctGeral.toFixed(1)}%
        </div>
      </header>

      {q.isLoading && <p className="text-sm opacity-70">Carregando…</p>}
      {q.isError && <p className="text-sm text-destructive">Não foi possível carregar a bipagem por base.</p>}
      {!q.isLoading && bases.length === 0 && (
        <p className={tv ? "text-white/60" : "text-sm text-muted-foreground"}>Nenhuma escala ativa para o dia.</p>
      )}

      <div className={tv ? "grid gap-4 md:grid-cols-2" : "grid gap-3 md:grid-cols-2"}>
        {bases.map((b) => {
          const pct = Math.max(0, Math.min(100, b.pct));
          return (
            <div
              key={b.base_id}
              className={tv ? "rounded-xl border border-white/10 bg-black/20 p-4" : "rounded-xl border bg-background p-3"}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className={tv ? "font-display text-xl font-bold" : "font-semibold text-sm"}>
                  {b.codigo}
                  <span className={tv ? "ml-2 text-white/50 text-sm font-normal" : "ml-2 text-muted-foreground text-xs font-normal"}>
                    {b.nome}
                  </span>
                </span>
                <span
                  className={tv ? "font-display text-2xl font-black tabular-nums" : "font-display text-lg font-black tabular-nums"}
                  style={{ color: tone(pct) }}
                >
                  {pct.toFixed(1)}%
                </span>
              </div>
              <div className={tv ? "mt-3 h-4 w-full rounded-full bg-white/10 overflow-hidden" : "mt-2 h-2.5 w-full rounded-full bg-muted overflow-hidden"}>
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: tone(pct) }} />
              </div>
              <div className={tv ? "mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-white/70" : "mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"}>
                <span>Rotas {b.total_rotas}</span>
                <span>Completas {b.rotas_completas}</span>
                <span>Parciais {b.rotas_parciais}</span>
                <span>Bipados {b.recebidos.toLocaleString("pt-BR")}</span>
                <span>Faltando {b.faltando.toLocaleString("pt-BR")}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
