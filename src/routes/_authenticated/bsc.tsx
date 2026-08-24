import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

const REPORT_URL = "https://datastudio.google.com/u/1/reporting/47d39180-57fc-4ed9-a568-d08f41fbb67f/page/p_57w7bopuyd";
const EMBED_URL = "https://lookerstudio.google.com/embed/reporting/47d39180-57fc-4ed9-a568-d08f41fbb67f/page/p_57w7bopuyd";

export const Route = createFileRoute("/_authenticated/bsc")({
  head: () => ({
    meta: [
      { title: "BSC — JM Transportes" },
      { name: "description", content: "Indicadores BSC da operação JM Transportes." },
    ],
  }),
  component: BscPage,
});

function BscPage() {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black tracking-tight">BSC</h1>
          <p className="text-sm text-muted-foreground">Indicadores estratégicos e operacionais da JM Transportes.</p>
        </div>
        <Button variant="outline" asChild>
          <a href={REPORT_URL} target="_blank" rel="noreferrer">
            <ExternalLink className="mr-2 h-4 w-4" />
            Abrir no Google
          </a>
        </Button>
      </header>

      <div className="min-h-[720px] flex-1 overflow-hidden rounded-xl border bg-card shadow-sm">
        <iframe
          title="BSC JM Transportes"
          src={EMBED_URL}
          className="h-full min-h-[720px] w-full border-0"
          allowFullScreen
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Caso o relatório solicite autenticação ou não carregue nesta tela, use “Abrir no Google” e entre com uma conta autorizada.
      </p>
    </div>
  );
}
