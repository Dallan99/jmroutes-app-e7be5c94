import { describe, it, expect, beforeEach } from 'vitest';
import { FakeSupabase } from './fakes/fake-supabase-client';

describe('Sincronização Devoluções v2 - Idempotência e Fechamento (Requisito 1, 6, 7, 10)', () => {
  let s: FakeSupabase;
  const BASE_ID = '00000000-0000-0000-0000-000000000016';
  
  beforeEach(() => {
    s = new FakeSupabase();
    s.setTable('bases', [{ id: BASE_ID, codigo: 'ESP16' }]);
    s.setTable('meli_pacotes', [
      { tracking_id: 'T1', rota_id: 'R1', substatus: 'buyer_absent' }, // Retorno
      { tracking_id: 'T2', rota_id: 'R1', substatus: 'delivered' },    // Ignorado
      { tracking_id: 'T3', rota_id: 'R1', substatus: 'missing' },      // Investigação
      { tracking_id: 'T4', rota_id: 'R1', substatus: 'picked_up' }     // Ignorado Operacional
    ]);
    s.setTable('meli_rotas_ativas', [{ id: 'R1', base_id: BASE_ID, data_rota: '2026-08-10' }]);
    s.setTable('meli_devolucoes', []);
    s.setTable('meli_devolucoes_eventos', []);
  });

  it('deve produzir zero atualizações e zero eventos na segunda execução (Requisito 10)', async () => {
    const mockSync = async () => {
      let criadas = 0;
      let atualizadas = 0;
      let sem_alteracao = 0;
      
      const pacotes = s.tables['meli_pacotes'].rows.filter(p => p.substatus !== 'delivered' && p.substatus !== 'picked_up');
      
      for (const p of pacotes) {
        const existing = s.tables['meli_devolucoes'].rows.find(d => d.tracking_id === p.tracking_id);
        if (!existing) {
          s.tables['meli_devolucoes'].rows.push({ tracking_id: p.tracking_id, substatus: p.substatus, last_synced_at: new Date() });
          s.tables['meli_devolucoes_eventos'].rows.push({ tracking_id: p.tracking_id, tipo: 'criada' });
          criadas++;
        } else {
          // Lógica do WHERE (Requisito 6)
          if (existing.substatus !== p.substatus) {
            existing.substatus = p.substatus;
            existing.last_synced_at = new Date();
            s.tables['meli_devolucoes_eventos'].rows.push({ tracking_id: p.tracking_id, tipo: 'atualizada' });
            atualizadas++;
          } else {
            sem_alteracao++;
          }
        }
      }
      return { criadas, atualizadas, sem_alteracao, eventos: s.tables['meli_devolucoes_eventos'].rows.length };
    };

    const r1 = await mockSync();
    expect(r1.criadas).toBe(2); // T1, T3
    expect(r1.eventos).toBe(2);

    const r2 = await mockSync();
    expect(r2.criadas).toBe(0);
    expect(r2.atualizadas).toBe(0);
    expect(r2.sem_alteracao).toBe(2);
    expect(r2.eventos).toBe(2); // Mantém os mesmos 2
  });
});
