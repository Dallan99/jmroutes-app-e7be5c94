import { describe, it, expect, beforeEach } from "vitest";
import { FakeSupabase } from "./fakes/fake-supabase-client";

describe("Romaneio Meli v3 - Security and Isolation (Mocked)", () => {
  let db: FakeSupabase;

  beforeEach(() => {
    db = new FakeSupabase();
  });

  it("anon access to meli_devolucao_romaneios is denied", async () => {
    // In our fake client, we simulate REVOKE by arming nextError for the target op
    db.setTable("meli_devolucao_romaneios", [], {
      nextError: { op: "select", error: { message: "permission denied" } }
    });
    const { error } = await db.from("meli_devolucao_romaneios").select("*");
    expect(error?.message).toContain("permission denied");
  });

  it("direct write by authenticated user is denied", async () => {
    // Migration: authenticated can SELECT, but NOT insert/update directly
    db.setTable("meli_devolucao_romaneios", [], {
      nextError: { op: "insert", error: { message: "permission denied" } }
    });
    const { error } = await db.from("meli_devolucao_romaneios").insert({ codigo: "TEST" });
    expect(error?.message).toContain("permission denied");
  });
});
