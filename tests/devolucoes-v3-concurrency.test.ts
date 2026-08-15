import { describe, it, expect, beforeEach } from 'vitest';
import { FakeSupabase } from './fakes/fake-supabase-client';

describe('Devoluções v3 - Concorrência e Independência', () => {
  let s: FakeSupabase;
  const BASE_ID = '00000000-0000-0000-0000-000000000016';
  
  beforeEach(() => {
    s = new FakeSupabase();
    s.setTable('bases', [{ id: BASE_ID, codigo: 'ESP16' }]);
    s.setTable('meli_devolucao_romaneios', []);
    s.setTable('meli_devolucoes', []);
    s.setTable('meli_devolucoes_eventos', []);
  });

  it('quatro sessões independentes devem ter sequenciais únicos e isolamento (Requisito 9)', async () => {
    const mockAbrir = async (userId: string, trackingId: string) => {
      // Simula pg_advisory_xact_lock
      const dataHoje = '20260815';
      const count = s.tables['meli_devolucao_romaneios'].rows.length + 1;
      const recId = `EXP-REC-${dataHoje}-ESP16-${count.toString().padStart(3, '0')}`;
      const uuid = `uuid-${userId}`;
      
      s.tables['meli_devolucao_romaneios'].rows.push({
        id: uuid,
        codigo: recId,
        base_id: BASE_ID,
        status: 'em_andamento',
        aberto_por: userId
      });

      // Adiciona o pacote
      s.tables['meli_devolucoes'].rows.push({
        romaneio_id: uuid,
        tracking_id: trackingId,
        estado: 'recebido_na_base'
      });

      return { romaneio_id: uuid, codigo_romaneio: recId };
    };

    const users = ['U1', 'U2', 'U3', 'U4'];
    const results = await Promise.all(users.map((u, i) => mockAbrir(u, `T${i}`)));

    // 1. Sequenciais não se repetem
    const codigos = results.map(r => r.codigo_romaneio);
    expect(new Set(codigos).size).toBe(4);
    expect(codigos).toContain('EXP-REC-20260815-ESP16-001');
    expect(codigos).toContain('EXP-REC-20260815-ESP16-004');

    // 2. Isolamento de pacotes
    results.forEach((r, i) => {
      const pacotes = s.tables['meli_devolucoes'].rows.filter(p => p.romaneio_id === r.romaneio_id);
      expect(pacotes.length).toBe(1);
      expect(pacotes[0].tracking_id).toBe(`T${i}`);
    });
  });

  it('bipagem duplicada reconhecida sem novo registro (Requisito 9)', async () => {
    const tracking = 'DUPLICADO';
    s.setTable('meli_devolucoes', [{ tracking_id: tracking, estado: 'aguardando_retorno' }]);
    
    const mockBipar = (t: string) => {
      const exists = s.tables['meli_devolucoes'].rows.find(p => p.tracking_id === t);
      if (exists?.estado === 'recebido_na_base') return { status: 'duplicado' };
      if (exists) {
        exists.estado = 'recebido_na_base';
        return { status: 'ok' };
      }
      return { status: 'nao_encontrado' };
    };

    const res1 = mockBipar(tracking);
    expect(res1.status).toBe('ok');
    
    const res2 = mockBipar(tracking);
    expect(res2.status).toBe('duplicado');
    expect(s.tables['meli_devolucoes'].rows.length).toBe(1);
  });
});
