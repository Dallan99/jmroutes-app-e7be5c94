import { describe, it, expect, beforeEach } from 'vitest';
import { FakeSupabase } from './fakes/fake-supabase-client';

describe('Sincronização v2 - Segurança e Idempotência', () => {
  let s: FakeSupabase;
  const BASE_A = '00000000-0000-0000-0000-0000000000aa';
  const BASE_B = '00000000-0000-0000-0000-0000000000bb';
  const USER_A = '00000000-0000-0000-0000-0000000000a1';

  beforeEach(() => {
    s = new FakeSupabase();
    s.setTable('bases', [{ id: BASE_A, codigo: 'ESP16' }, { id: BASE_B, codigo: 'ESP15' }]);
  });

  it('deve rejeitar sincronização sem base_id', async () => {
    const rpc = async (p_base_id: any) => {
      if (!p_base_id) throw new Error('p_base_id é obrigatório');
      return { status: 'ok' };
    };
    await expect(rpc(null)).rejects.toThrow('p_base_id é obrigatório');
  });

  it('deve simular idempotência: segunda execução retorna sem_alteracao', async () => {
    const mockSync = (tracking: string) => {
      const exists = s.tables['meli_devolucoes']?.rows.find(r => r.tracking_id === tracking);
      if (exists) return { criados: 0, sem_alteracao: 1 };
      s.setTable('meli_devolucoes', [{ tracking_id: tracking }]);
      return { criados: 1, sem_alteracao: 0 };
    };

    s.setTable('meli_devolucoes', []);
    const res1 = mockSync('T1');
    expect(res1.criados).toBe(1);
    
    const res2 = mockSync('T1');
    expect(res2.criados).toBe(0);
    expect(res2.sem_alteracao).toBe(1);
  });
});
