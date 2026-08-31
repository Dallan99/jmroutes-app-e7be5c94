import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronsUpDown, KeyRound, Loader2, Plus, Power, Truck } from "lucide-react";
import { toast } from "sonner";
import { listarMotoristasMeli } from "@/lib/expedicao.functions";
import { criarAcessoMotorista, definirMotoristaAtivo, listarBasesParaMotorista, listarMotoristasCadastrados, type MotoristaCadastro } from "@/lib/motoristas.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/motoristas")({ ssr: false, head: () => ({ meta: [{ title: "Motoristas — JM Transportes" }] }), component: MotoristasPage });

function MotoristasPage() {
  const qc = useQueryClient(); const listarFn = useServerFn(listarMotoristasCadastrados); const ativoFn = useServerFn(definirMotoristaAtivo);
  const motoristas = useQuery({ queryKey: ["motoristas-cadastrados"], queryFn: () => listarFn() }); const [novo, setNovo] = useState(false);
  const alterarAtivo = useMutation({ mutationFn: (m: MotoristaCadastro) => ativoFn({ data: { id: m.id, ativo: !m.ativo } }), onSuccess: () => void qc.invalidateQueries({ queryKey: ["motoristas-cadastrados"] }), onError: (erro: Error) => toast.error(erro.message) });
  return <div className="space-y-4 p-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="font-display text-2xl font-bold">Acessos de motoristas</h1><p className="text-sm text-muted-foreground">Cadastro separado dos funcionários, vinculado ao motorista existente no AdminML.</p></div><Button onClick={() => setNovo(true)}><Plus className="mr-2 h-4 w-4" />Criar acesso</Button></div>
    <Card className="overflow-hidden p-0"><Table><TableHeader><TableRow><TableHead>Motorista</TableHead><TableHead>Usuário</TableHead><TableHead>Estação</TableHead><TableHead>Vínculo AdminML</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader><TableBody>
      {(motoristas.data ?? []).map((m) => <TableRow key={m.id}><TableCell className="font-medium">{m.nome}<div className="text-xs text-muted-foreground">{m.placa || "Placa ainda não informada pelo Meli"}</div></TableCell><TableCell>{m.usuario ?? <span className="text-muted-foreground">Sem acesso</span>}</TableCell><TableCell>{m.baseNome ?? "Todas as estações"}</TableCell><TableCell><div>{m.meliNome ?? "Motorista Meli"}</div><div className="font-mono text-xs text-muted-foreground">ID {m.meliDriverId}</div></TableCell><TableCell><Badge variant={m.ativo ? "secondary" : "destructive"}>{m.ativo ? "Ativo" : "Inativo"}</Badge></TableCell><TableCell className="text-right"><Button size="icon" variant="ghost" title={m.ativo ? "Desativar acesso" : "Ativar acesso"} onClick={() => alterarAtivo.mutate(m)}><Power className="h-4 w-4" /></Button></TableCell></TableRow>)}
      {!motoristas.isLoading && !(motoristas.data ?? []).length && <TableRow><TableCell colSpan={6} className="py-12 text-center text-muted-foreground"><Truck className="mx-auto mb-2 h-7 w-7" />Nenhum acesso de motorista criado.</TableCell></TableRow>}
    </TableBody></Table></Card><CriarAcesso open={novo} onClose={() => setNovo(false)} onDone={() => void qc.invalidateQueries({ queryKey: ["motoristas-cadastrados"] })} />
  </div>;
}

function CriarAcesso({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const criarFn = useServerFn(criarAcessoMotorista); const catalogoFn = useServerFn(listarMotoristasMeli); const basesFn = useServerFn(listarBasesParaMotorista);
  const catalogo = useQuery({ queryKey: ["catalogo-motoristas-meli"], queryFn: () => catalogoFn({ data: {} }), enabled: open }); const bases = useQuery({ queryKey: ["bases-motoristas"], queryFn: () => basesFn(), enabled: open });
  const [usuario, setUsuario] = useState(""); const [meliDriverId, setMeliDriverId] = useState(""); const [motoristasOpen, setMotoristasOpen] = useState(false); const [baseId, setBaseId] = useState("todas"); const [senha, setSenha] = useState(""); const [confirmarSenha, setConfirmarSenha] = useState("");
  const selecionado = (catalogo.data ?? []).find((m) => m.id === meliDriverId);
  const criar = useMutation({ mutationFn: () => criarFn({ data: { usuario, meliDriverId, baseId: baseId === "todas" ? null : baseId, senha, confirmarSenha } }), onSuccess: () => { toast.success("Acesso do motorista criado."); onDone(); onClose(); setUsuario(""); setMeliDriverId(""); setBaseId("todas"); setSenha(""); setConfirmarSenha(""); }, onError: (erro: Error) => toast.error(erro.message) });
  return <Dialog open={open} onOpenChange={(v) => !v && onClose()}><DialogContent><DialogHeader><DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" />Criar acesso</DialogTitle><DialogDescription>Selecione o motorista e defina o acesso. O nome será preenchido automaticamente pelo AdminML.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={(e) => { e.preventDefault(); criar.mutate(); }}>
    <div className="space-y-1"><Label>Usuário</Label><Input required minLength={3} value={usuario} onChange={(e) => setUsuario(e.target.value.replace(/[^a-zA-Z0-9._-]/g, ""))} placeholder="Ex.: dallan" /><p className="text-xs text-muted-foreground">Letras, números e os símbolos . _ -</p></div>
    <div className="space-y-1"><Label>Motorista existente no AdminML</Label><Popover open={motoristasOpen} onOpenChange={setMotoristasOpen}><PopoverTrigger asChild><Button type="button" variant="outline" role="combobox" aria-expanded={motoristasOpen} className="w-full justify-between font-normal">{selecionado?.nome ?? "Selecione ou pesquise um motorista..."}<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" /></Button></PopoverTrigger><PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0"><Command><CommandInput placeholder="Buscar por nome ou ID..." /><CommandList><CommandEmpty>Nenhum motorista encontrado.</CommandEmpty><CommandGroup>{(catalogo.data ?? []).map((m) => <CommandItem key={m.id} value={`${m.nome} ${m.id}`} disabled={m.status !== "active"} onSelect={() => { setMeliDriverId(m.id); setMotoristasOpen(false); }}><Check className={cn("h-4 w-4", meliDriverId === m.id ? "opacity-100" : "opacity-0")} /><span className="min-w-0 flex-1 truncate">{m.nome}</span><span className="text-xs text-muted-foreground">{m.status !== "active" ? "Indisponível" : `ID ${m.id}`}</span></CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent></Popover>{selecionado && <p className="text-xs text-muted-foreground">Nome do acesso: {selecionado.nome}</p>}</div>
    <div className="space-y-1"><Label>Estação</Label><Select value={baseId} onValueChange={setBaseId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todas">Todas as estações</SelectItem>{(bases.data ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.codigo} — {b.nome}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">“Todas” permite que o motorista receba rotas de qualquer base.</p></div>
    <div className="space-y-1"><Label>Senha inicial</Label><Input type="password" required minLength={8} value={senha} onChange={(e) => setSenha(e.target.value)} /></div><div className="space-y-1"><Label>Confirmar senha</Label><Input type="password" required minLength={8} value={confirmarSenha} onChange={(e) => setConfirmarSenha(e.target.value)} /></div>
    <DialogFooter><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={criar.isPending || !meliDriverId}>{criar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Criar acesso</Button></DialogFooter>
  </form></DialogContent></Dialog>;
}
