import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ler = (arquivo: string) => readFileSync(resolve(process.cwd(), arquivo), "utf8");
const funcoes = ler("src/lib/expedicao.functions.ts");
const app = ler("src/routes/_authenticated/motorista.tsx");
const usuarios = ler("src/routes/_authenticated/usuarios.tsx");
const motoristas = ler("src/routes/_authenticated/motoristas.tsx");
const cadastro = ler("src/lib/motoristas.functions.ts");
const auth = ler("src/routes/auth.tsx");
const migracao = ler("supabase/migrations/20260831151041_separar_cadastro_motoristas.sql");

describe("App do motorista vinculado ao catálogo Meli", () => {
  it("mantém o cadastro operacional separado dos funcionários", () => {
    expect(migracao).toContain("ALTER TABLE public.motoristas");
    expect(migracao).toContain("motoristas_meli_driver_id_uidx");
    expect(motoristas).toContain("Cadastro independente dos funcionários da JM");
    expect(usuarios).not.toContain("Identidade no app do motorista");
  });

  it("pede somente nome, placa e vínculo com o motorista Meli", () => {
    expect(motoristas).toContain("Nome do motorista");
    expect(motoristas).toContain("Placa do veículo");
    expect(motoristas).toContain("Vincular ao motorista do Meli");
    expect(motoristas).not.toContain("Senha inicial");
    expect(motoristas).not.toContain("Email");
  });

  it("busca atribuições diretamente pelo driver_id que veio nas rotas do Meli", () => {
    expect(funcoes).toContain('.from("meli_rotas")');
    expect(funcoes).toContain('.eq("driver_id", perfil.meli_driver_id)');
    expect(funcoes).toContain("listarMinhasRotasMeliMotorista");
  });

  it("materializa o vínculo do cadastro nas rotas atuais e futuras", () => {
    expect(migracao).toContain("trg_vincular_motorista_cadastrado_na_rota_meli");
    expect(cadastro).toContain('.from("meli_rotas")');
    expect(cadastro).toContain("motorista_id: motoristaId!");
  });

  it("não deixa o motorista iniciar rota alheia ou ainda não recebida", () => {
    expect(funcoes).toContain("Esta rota não está atribuída a você no Meli.");
    expect(funcoes).toContain("A operação ainda não concluiu o Recebimento desta rota.");
    expect(app).toContain("Aguardando Recebimento");
  });

  it("envia contas vinculadas diretamente para a experiência móvel", () => {
    expect(auth).toContain('perfil?.meli_driver_id ? "/motorista" : "/dashboard"');
    expect(app).toContain("Iniciar conferência");
  });
});
