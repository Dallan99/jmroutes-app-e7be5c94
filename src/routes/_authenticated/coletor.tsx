import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { PackageSearch, RotateCcw, ScanBarcode } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useCollectorMode } from "@/lib/collector-mode";

export const Route = createFileRoute("/_authenticated/coletor")({
  head: () => ({ meta: [{ title: "Modo Coletor — JM Transportes" }] }),
  component: ModoColetorPage,
});

const funcoes = [
  { titulo: "Recebimento", descricao: "Receber e conferir pacotes", to: "/recebimento", icon: ScanBarcode },
  { titulo: "Triagem", descricao: "Bipar por leitor ou câmera", to: "/triagem", icon: PackageSearch },
  { titulo: "Devoluções", descricao: "Registrar retornos ao Meli", to: "/meli-devolucoes", icon: RotateCcw },
] as const;

function ModoColetorPage() {
  const { ativarModoColetor } = useCollectorMode();
  useEffect(() => ativarModoColetor(), [ativarModoColetor]);

  return (
    <div className="mx-auto w-full max-w-lg p-3 sm:p-5">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Modo Coletor</h1>
        <p className="text-sm text-muted-foreground">Escolha uma função para iniciar a operação.</p>
      </div>
      <div className="grid gap-3">
        {funcoes.map((item) => (
          <Link key={item.to} to={item.to} className="block">
            <Card className="flex min-h-24 items-center gap-4 p-4 transition-colors active:bg-muted">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <item.icon className="h-7 w-7" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">{item.titulo}</h2>
                <p className="text-sm text-muted-foreground">{item.descricao}</p>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
