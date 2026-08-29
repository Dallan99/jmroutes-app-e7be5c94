import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, PackageCheck, ScanLine, Truck } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  biparExpedicao,
  detalharExpedicao,
  listarMinhasExpedicoesMotorista,
} from "@/lib/expedicao.functions";

export const Route = createFileRoute("/_authenticated/motorista")({
  head: () => ({ meta: [{ title: "Meu carregamento — JM Transportes" }] }),
  component: AppMotorista,
});

function AppMotorista() {
  const listarFn = useServerFn(listarMinhasExpedicoesMotorista);
  const detalheFn = useServerFn(detalharExpedicao);
  const biparFn = useServerFn(biparExpedicao);
  const inputRef = useRef<HTMLInputElement>(null);
  const [expedicaoId, setExpedicaoId] = useState<string | null>(null);
  const [codigo, setCodigo] = useState("");

  const rotas = useQuery({ queryKey: ["minhas-expedicoes-motorista"], queryFn: () => listarFn() });
  const detalhe = useQuery({
    queryKey: ["expedicao-motorista", expedicaoId],
    queryFn: () => detalheFn({ data: { expedicaoId: expedicaoId! } }),
    enabled: !!expedicaoId,
  });
  const bipar = useMutation({
    mutationFn: (leitura: string) => biparFn({ data: { expedicaoId: expedicaoId!, codigo: leitura } }),
    onSuccess: (resultado) => {
      resultado.resultado === "ok" ? toast.success(resultado.mensagem) : toast.error(resultado.mensagem);
      setCodigo("");
      void detalhe.refetch();
      void rotas.refetch();
      setTimeout(() => inputRef.current?.focus(), 50);
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  const expedicao = detalhe.data?.expedicao;
  const previsto = expedicao?.quantidade_prevista ?? 0;
  const conferido = expedicao?.quantidade_conferida ?? 0;
  const percentual = previsto ? Math.round((conferido / previsto) * 100) : 0;

  return (
    <div className="mx-auto min-h-[calc(100vh-3.5rem)] max-w-lg space-y-4 bg-muted/20 p-4 pb-24">
      <header className="flex items-center gap-3 py-2">
        <div className="rounded-xl bg-primary p-3 text-primary-foreground"><Truck className="h-6 w-6" /></div>
        <div><h1 className="font-display text-2xl font-bold">Meu carregamento</h1><p className="text-sm text-muted-foreground">Confira sua rota pelo celular.</p></div>
      </header>

      {!expedicaoId ? (
        <div className="space-y-3">
          {(rotas.data ?? []).map((rota) => (
            <Card key={rota.id} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div><div className="text-xs text-muted-foreground">Rota</div><div className="font-mono text-2xl font-bold">{rota.rota}</div></div>
                <Badge>{rota.status}</Badge>
              </div>
              <div className="text-sm">{rota.quantidade_conferida} de {rota.quantidade_prevista} volumes conferidos</div>
              <Progress value={rota.quantidade_prevista ? (rota.quantidade_conferida / rota.quantidade_prevista) * 100 : 0} />
              <Button className="h-12 w-full" onClick={() => setExpedicaoId(rota.id)}><PackageCheck className="mr-2 h-5 w-5" />Entrar na rota</Button>
            </Card>
          ))}
          {!rotas.isLoading && !(rotas.data ?? []).length && (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              Nenhuma rota foi atribuída ao seu usuário. Peça à operação para conferir o vínculo com seu cadastro Meli.
            </Card>
          )}
        </div>
      ) : (
        <Card className="space-y-5 p-4">
          <div className="flex items-center justify-between"><Button variant="ghost" onClick={() => setExpedicaoId(null)}>Minhas rotas</Button><Badge>{expedicao?.status ?? "carregando"}</Badge></div>
          <div className="text-center"><div className="font-mono text-3xl font-bold">{expedicao?.rota}</div><div className="mt-1 text-sm text-muted-foreground">{conferido} de {previsto} volumes</div></div>
          <Progress value={percentual} />
          {conferido >= previsto && previsto > 0 ? (
            <div className="rounded-xl bg-emerald-500/10 p-5 text-center text-emerald-700"><CheckCircle2 className="mx-auto mb-2 h-9 w-9" /><b>Conferência completa</b></div>
          ) : (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const valor = codigo.trim(); if (valor) bipar.mutate(valor); }}>
              <label className="flex items-center gap-2 font-medium"><ScanLine className="h-5 w-5" />Bipe o shipment</label>
              <Input ref={inputRef} autoFocus inputMode="numeric" className="h-14 text-lg" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Shipment ID" />
              <Button className="h-14 w-full text-base" disabled={!codigo.trim() || bipar.isPending}>Confirmar volume</Button>
            </form>
          )}
        </Card>
      )}
    </div>
  );
}
