import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, Smartphone, Truck } from "lucide-react";
import { listarUsuarios } from "@/lib/usuarios.functions";
import { meuPerfil } from "@/lib/recebimento.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/motoristas")({
  ssr: false,
  head: () => ({ meta: [{ title: "Motoristas — JM Transportes" }] }),
  component: MotoristasPage,
});

function MotoristasPage() {
  const perfilFn = useServerFn(meuPerfil);
  const listarFn = useServerFn(listarUsuarios);
  const perfil = useQuery({ queryKey: ["meu-perfil"], queryFn: () => perfilFn() });
  const admin = (perfil.data?.roles ?? []).includes("admin");
  const usuarios = useQuery({
    queryKey: ["usuarios-motoristas"],
    queryFn: () => listarFn(),
    enabled: admin,
  });
  const motoristas = (usuarios.data ?? []).filter((u) => !!u.meli_driver_id);

  if (perfil.isLoading) return <div className="p-6 text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Carregando…</div>;
  if (!admin) return <div className="p-6"><Card className="p-6">Acesso restrito a administradores.</Card></div>;

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Motoristas do aplicativo</h1>
          <p className="text-sm text-muted-foreground">Contas internas vinculadas ao catálogo oficial de motoristas do Meli.</p>
        </div>
        <Button asChild><Link to="/usuarios"><Plus className="mr-2 h-4 w-4" />Cadastrar motorista</Link></Button>
      </div>

      <Card className="grid gap-3 p-4 sm:grid-cols-3">
        <div><div className="text-xs text-muted-foreground">Motoristas vinculados</div><div className="text-2xl font-bold">{motoristas.length}</div></div>
        <div className="flex items-center gap-3"><Smartphone className="h-5 w-5 text-primary" /><span className="text-sm">Ao entrar, seguem direto para o app do motorista.</span></div>
        <div className="flex items-center gap-3"><Truck className="h-5 w-5 text-primary" /><span className="text-sm">As rotas aparecem pelo vínculo do ID Meli.</span></div>
      </Card>

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Motorista JM</TableHead><TableHead>Placa</TableHead><TableHead>Base</TableHead><TableHead>Vínculo Meli</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {motoristas.map((motorista) => (
              <TableRow key={motorista.id}>
                <TableCell><div className="font-medium">{motorista.nome}</div><div className="text-xs text-muted-foreground">{motorista.email}</div></TableCell>
                <TableCell className="font-mono">{motorista.placa ?? "—"}</TableCell>
                <TableCell>{motorista.base_nome ?? "—"}</TableCell>
                <TableCell><div>{motorista.meli_driver_nome ?? "Motorista Meli"}</div><div className="font-mono text-xs text-muted-foreground">ID {motorista.meli_driver_id}</div></TableCell>
                <TableCell><Badge variant={motorista.ativo ? "secondary" : "destructive"}>{motorista.ativo ? "Ativo" : "Inativo"}</Badge></TableCell>
                <TableCell className="text-right"><Button asChild size="sm" variant="outline"><Link to="/usuarios">Editar</Link></Button></TableCell>
              </TableRow>
            ))}
            {!usuarios.isLoading && !motoristas.length && <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Nenhum motorista vinculado. Clique em “Cadastrar motorista”.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
