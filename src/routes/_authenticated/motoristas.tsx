import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Pencil, Plus, Power, Truck } from "lucide-react";
import { toast } from "sonner";
import { listarMotoristasMeli } from "@/lib/expedicao.functions";
import { definirMotoristaAtivo, listarMotoristasCadastrados, salvarMotoristaCadastrado, type MotoristaCadastro } from "@/lib/motoristas.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/motoristas")({ ssr: false, head: () => ({ meta: [{ title: "Motoristas — JM Transportes" }] }), component: MotoristasPage });

function MotoristasPage() {
  const qc = useQueryClient();
  const listarFn = useServerFn(listarMotoristasCadastrados);
  const ativoFn = useServerFn(definirMotoristaAtivo);
  const motoristas = useQuery({ queryKey: ["motoristas-cadastrados"], queryFn: () => listarFn() });
  const [form, setForm] = useState<MotoristaCadastro | "novo" | null>(null);
  const alterarAtivo = useMutation({
    mutationFn: (m: MotoristaCadastro) => ativoFn({ data: { id: m.id, ativo: !m.ativo } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["motoristas-cadastrados"] }),
    onError: (erro: Error) => toast.error(erro.message),
  });

  return <div className="space-y-4 p-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="font-display text-2xl font-bold">Motoristas</h1><p className="text-sm text-muted-foreground">Cadastro independente dos funcionários da JM.</p></div><Button onClick={() => setForm("novo")}><Plus className="mr-2 h-4 w-4" />Novo motorista</Button></div>
    <Card className="overflow-hidden p-0"><Table>
      <TableHeader><TableRow><TableHead>Nome do motorista</TableHead><TableHead>Placa</TableHead><TableHead>Motorista vinculado no Meli</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
      <TableBody>
        {(motoristas.data ?? []).map((m) => <TableRow key={m.id}>
          <TableCell className="font-medium">{m.nome}</TableCell><TableCell className="font-mono">{m.placa}</TableCell>
          <TableCell><div>{m.meliNome ?? "Motorista Meli"}</div><div className="font-mono text-xs text-muted-foreground">ID {m.meliDriverId}</div></TableCell>
          <TableCell><Badge variant={m.ativo ? "secondary" : "destructive"}>{m.ativo ? "Ativo" : "Inativo"}</Badge></TableCell>
          <TableCell className="text-right"><Button size="icon" variant="ghost" title="Editar" onClick={() => setForm(m)}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" title={m.ativo ? "Desativar" : "Ativar"} onClick={() => alterarAtivo.mutate(m)}><Power className="h-4 w-4" /></Button></TableCell>
        </TableRow>)}
        {!motoristas.isLoading && !(motoristas.data ?? []).length && <TableRow><TableCell colSpan={5} className="py-12 text-center text-muted-foreground"><Truck className="mx-auto mb-2 h-7 w-7" />Nenhum motorista cadastrado.</TableCell></TableRow>}
      </TableBody>
    </Table></Card>
    <MotoristaForm motorista={form} onClose={() => setForm(null)} onDone={() => void qc.invalidateQueries({ queryKey: ["motoristas-cadastrados"] })} />
  </div>;
}

function MotoristaForm({ motorista, onClose, onDone }: { motorista: MotoristaCadastro | "novo" | null; onClose: () => void; onDone: () => void }) {
  const salvarFn = useServerFn(salvarMotoristaCadastrado);
  const catalogoFn = useServerFn(listarMotoristasMeli);
  const catalogo = useQuery({ queryKey: ["catalogo-motoristas-meli"], queryFn: () => catalogoFn({ data: {} }), enabled: !!motorista });
  const [nome, setNome] = useState(""); const [placa, setPlaca] = useState(""); const [meliDriverId, setMeliDriverId] = useState("");
  useEffect(() => { setNome(motorista !== "novo" && motorista ? motorista.nome : ""); setPlaca(motorista !== "novo" && motorista ? motorista.placa : ""); setMeliDriverId(motorista !== "novo" && motorista ? motorista.meliDriverId : ""); }, [motorista]);
  const salvar = useMutation({
    mutationFn: () => salvarFn({ data: { id: motorista !== "novo" ? motorista?.id : undefined, nome, placa, meliDriverId } }),
    onSuccess: () => { toast.success(motorista === "novo" ? "Motorista cadastrado." : "Motorista atualizado."); onDone(); onClose(); },
    onError: (erro: Error) => toast.error(erro.message),
  });
  return <Dialog open={!!motorista} onOpenChange={(aberto) => !aberto && onClose()}><DialogContent>
    <DialogHeader><DialogTitle>{motorista === "novo" ? "Novo motorista" : "Editar motorista"}</DialogTitle><DialogDescription>Este cadastro não cria funcionário, e-mail ou usuário administrativo.</DialogDescription></DialogHeader>
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); salvar.mutate(); }}>
      <div className="space-y-1"><Label>Nome do motorista</Label><Input required value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome completo" /></div>
      <div className="space-y-1"><Label>Placa do veículo</Label><Input required value={placa} maxLength={7} onChange={(e) => setPlaca(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())} placeholder="ABC1D23" /></div>
      <div className="space-y-1"><Label>Vincular ao motorista do Meli</Label><Select required value={meliDriverId} onValueChange={setMeliDriverId}><SelectTrigger><SelectValue placeholder="Selecione um motorista" /></SelectTrigger><SelectContent>{(catalogo.data ?? []).map((item) => <SelectItem key={item.id} value={item.id} disabled={item.status !== "active"}>{item.nome}{item.status !== "active" ? " — indisponível" : ""}</SelectItem>)}</SelectContent></Select></div>
      <DialogFooter><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={salvar.isPending || !meliDriverId}>{salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar motorista</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
