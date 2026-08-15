import { describe, it, expect, beforeEach, vi } from "vitest";

// Local storage logic mirroring the component
class StorageMock {
  store: Record<string, string> = {};
  getItem(key: string) { return this.store[key] || null; }
  setItem(key: string, value: string) { this.store[key] = value.toString(); }
  removeItem(key: string) { delete this.store[key]; }
  clear() { this.store = {}; }
}

describe("Meli Devolucoes - Interface State and Validation (Logic Only)", () => {
  let localStorageMock: StorageMock;

  beforeEach(() => {
    localStorageMock = new StorageMock();
  });

  it("identifies and discards legacy REC... ID without UUID", () => {
    localStorageMock.setItem("active_rec_id", "REC20260814005");
    
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

  it("prevents setting non-UUID values as romaneio_id", () => {
    const updateActiveRec = (id: string, uuid?: string) => {
      if (!id || !uuid) return;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
        return;
      }
      localStorageMock.setItem("active_rec_id", id);
      localStorageMock.setItem("active_romaneio_uuid", uuid);
    };

    updateActiveRec("LEGACY", "REC20260814005");
    
    expect(localStorageMock.getItem("active_romaneio_uuid")).toBeNull();
  });
});
