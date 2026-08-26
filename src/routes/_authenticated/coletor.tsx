import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { JmLogo } from "@/components/jm-logo";
import { useCollectorMode } from "@/lib/collector-mode";

export const Route = createFileRoute("/_authenticated/coletor")({
  head: () => ({ meta: [{ title: "JMRoutes Coletor — JM Transportes" }] }),
  component: ModoColetorPage,
});

function ModoColetorPage() {
  const { ativarModoColetor } = useCollectorMode();

  useEffect(() => ativarModoColetor(), [ativarModoColetor]);

  return (
    <div className="flex min-h-[calc(100dvh-7rem)] items-center justify-center px-8 pb-10">
      <JmLogo
        size={280}
        className="h-auto w-full max-w-[280px] rounded-[2rem] shadow-2xl shadow-primary/20"
      />
    </div>
  );
}
