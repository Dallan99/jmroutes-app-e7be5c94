import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Download, PackageSearch, RotateCcw, ScanBarcode, Share } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCollectorMode } from "@/lib/collector-mode";
import { toast } from "sonner";
import {
  clearPwaInstallPrompt,
  getPwaInstallPrompt,
  subscribePwaInstallPrompt,
  type PwaInstallPromptEvent,
} from "@/lib/pwa-install";

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
  const [installPrompt, setInstallPrompt] = useState<PwaInstallPromptEvent | null>(() => getPwaInstallPrompt());
  const [instalado, setInstalado] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => ativarModoColetor(), [ativarModoColetor]);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    setInstalado(standalone);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));

    const unsubscribe = subscribePwaInstallPrompt(setInstallPrompt);
    const handleInstalled = () => {
      setInstalado(true);
    };
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      unsubscribe();
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  async function instalarApp() {
    if (installPrompt) {
      await installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      if (outcome === "accepted") toast.success("JMRoutes Coletor instalado.");
      clearPwaInstallPrompt();
      return;
    }

    if (ios) {
      toast.info("No Safari, toque em Compartilhar e depois em Adicionar à Tela de Início.", { duration: 7000 });
      return;
    }

    const navegador = /Edg\//i.test(navigator.userAgent) ? "Edge" : "navegador";
    toast.info(`No ${navegador}, abra o menu e toque em Instalar aplicativo ou Adicionar à tela inicial.`, { duration: 7000 });
  }

  return (
    <div className="mx-auto w-full max-w-lg p-3 sm:p-5">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Modo Coletor</h1>
        <p className="text-sm text-muted-foreground">Escolha uma função para iniciar a operação.</p>
      </div>
      {!instalado && (
        <Card className="mb-4 border-primary/25 bg-primary/5 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              {ios ? <Share className="h-5 w-5" /> : <Download className="h-5 w-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">Instale no celular</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {ios
                  ? "No Safari, toque em Compartilhar e depois em Adicionar à Tela de Início."
                  : "Abra o coletor pela tela inicial, como um aplicativo."}
              </p>
              <Button className="mt-3 h-11 w-full sm:w-auto" onClick={instalarApp}>
                {ios ? <Share className="mr-2 h-4 w-4" /> : <Download className="mr-2 h-4 w-4" />}
                Baixar app no celular
              </Button>
            </div>
          </div>
        </Card>
      )}
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
