import { describe, it, expect, beforeEach } from "vitest";
import { FakeSupabaseClient } from "./fakes/fake-supabase-client";

describe("Romaneio Meli v3 - Security and Isolation (Mocked)", () => {
  let db: FakeSupabaseClient;

  beforeEach(() => {
    db = new FakeSupabaseClient();
  });

  it("anon access to meli_devolucao_romaneios is denied", async () => {
    // In our fake client, we assume no session means anon
    const { error } = await db.from("meli_devolucao_romaneios").select("*");
    // Since migration has REVOKE ALL FROM PUBLIC/anon, any direct access without session should fail
    expect(error?.message).toContain("permission denied");
  });

  it("anon execution of RPC is denied", async () => {
    const { error } = await db.rpc("meli_romaneio_abrir_com_primeiro_pacote", { p_base_id: 'b1', p_tracking_id: 'T1' });
    expect(error?.message).toContain("permission denied");
  });

  it("authenticated without base access is denied", async () => {
    // We mock a user without base access
    db.setAuthUser("user-no-access", ["base-x"]); 
    const { error } = await db.rpc("meli_romaneio_abrir_com_primeiro_pacote", { 
      p_base_id: "base-y", 
      p_tracking_id: "TRACK123" 
    });
    
    expect(error?.message).toContain("Sem acesso à base");
  });

  it("internal function is not accessible to authenticated user", async () => {
    db.setAuthUser("user-1", ["base-1"]);
    const { error } = await db.rpc("internal_meli_devolucao_processar_bip", { p_romaneio_id: 'r1' });
    expect(error?.message).toContain("permission denied");
  });

  it("direct write by authenticated user is denied", async () => {
    db.setAuthUser("user-1", ["base-1"]);
    const { error } = await db.from("meli_devolucao_romaneios").insert({ codigo: "TEST" });
    expect(error?.message).toContain("permission denied");
  });
});
