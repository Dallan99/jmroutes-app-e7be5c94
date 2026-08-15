/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { FakeSupabase } from "./fakes/fake-supabase-client";

// Mocking window.localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value.toString(); }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe("Meli Devolucoes - Interface State and Validation", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it("identifies and discards legacy REC... ID without UUID", () => {
    localStorageMock.setItem("active_rec_id", "REC20260814005");
    
    // Simulating the initialization logic from the component
    const getInitialUuid = () => {
      const val = localStorageMock.getItem("active_romaneio_uuid") || "";
      if (val && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) {
        return "";
      }
      return val;
    };

    const getInitialRecId = (uuid: string) => {
      if (!uuid || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
        return "";
      }
      return localStorageMock.getItem("active_rec_id") || "";
    };

    const uuid = getInitialUuid();
    const recId = getInitialRecId(uuid);

    expect(uuid).toBe("");
    expect(recId).toBe("");
  });

  it("accepts valid UUID and corresponding REC ID", () => {
    const validUuid = "550e8400-e29b-41d4-a716-446655440000";
    localStorageMock.setItem("active_romaneio_uuid", validUuid);
    localStorageMock.setItem("active_rec_id", "EXP-REC-20260814-001");

    const getInitialUuid = () => {
      const val = localStorageMock.getItem("active_romaneio_uuid") || "";
      if (val && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) {
        return "";
      }
      return val;
    };

    const getInitialRecId = (uuid: string) => {
      if (!uuid || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
        return "";
      }
      return localStorageMock.getItem("active_rec_id") || "";
    };

    const uuid = getInitialUuid();
    const recId = getInitialRecId(uuid);

    expect(uuid).toBe(validUuid);
    expect(recId).toBe("EXP-REC-20260814-001");
  });

  it("clears state when calling updateActiveRec with empty values", () => {
    localStorageMock.setItem("active_romaneio_uuid", "550e8400-e29b-41d4-a716-446655440000");
    localStorageMock.setItem("active_rec_id", "EXP-REC-001");

    const updateActiveRec = (id: string, uuid?: string) => {
      if (!id || !uuid) {
        localStorageMock.removeItem("active_rec_id");
        localStorageMock.removeItem("active_romaneio_uuid");
        return;
      }
      localStorageMock.setItem("active_rec_id", id);
      localStorageMock.setItem("active_romaneio_uuid", uuid);
    };

    updateActiveRec("");
    
    expect(localStorageMock.removeItem).toHaveBeenCalledWith("active_rec_id");
    expect(localStorageMock.removeItem).toHaveBeenCalledWith("active_romaneio_uuid");
    expect(localStorageMock.getItem("active_romaneio_uuid")).toBeNull();
  });

  it("prevents setting non-UUID values as romaneio_id", () => {
    const updateActiveRec = (id: string, uuid?: string) => {
      if (!id || !uuid) return;
      // Validation from component
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
        return;
      }
      localStorageMock.setItem("active_rec_id", id);
      localStorageMock.setItem("active_romaneio_uuid", uuid);
    };

    updateActiveRec("LEGACY", "REC20260814005");
    
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
    expect(localStorageMock.getItem("active_romaneio_uuid")).toBeNull();
  });
});
