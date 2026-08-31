import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ler = (arquivo: string) => readFileSync(resolve(process.cwd(), arquivo), "utf8");
const funcoes = ler("src/lib/expedicao.functions.ts");
const app = ler("src/routes/_authenticated/motorista.tsx");
const usuarios = ler("src/routes/_authenticated/usuarios.tsx");
const auth = ler("src/routes/auth.tsx");
const migracao = ler("supabase/migrations/20260829162801_cadastro_motorista_app.sql");

describe("App do motorista vinculado ao catálogo Meli", () => {
  it("mantém um vínculo Meli único por conta e armazena a placa", () => {
    expect(migracao).toContain("profiles_meli_driver_id_uidx");
    expect(migracao).toContain("ADD COLUMN IF NOT EXISTS placa");
    expect(usuarios).toContain("Identidade no app do motorista");
    expect(usuarios).toContain("Placa do motorista");
  });

  it("busca atribuições diretamente pelo driver_id que veio nas rotas do Meli", () => {
    expect(funcoes).toContain('.from("meli_rotas")');
    expect(funcoes).toContain('.eq("driver_id", perfil.meli_driver_id)');
    expect(funcoes).toContain("listarMinhasRotasMeliMotorista");
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
