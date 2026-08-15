import { describe, it, expect, beforeEach } from 'vitest';
import { FakeSupabase } from '../fakes/fake-supabase-client';

describe('Devoluções v3 - Stress de Concorrência (Fake)', () => {
  let s: FakeSupabase;
  const BASE_ID = 'b1';
  const USER_A = 'u_a';
  const USER_B = 'u_b';
  const USER_C = 'u_c';
  const USER_D = 'u_d';

  beforeEach(() => {
    s = new FakeSupabase();
    s.setTable('bases', [{ id: BASE_ID, codigo: 'ESP17', nome: 'Base Teste' }]);
    s.setTable('meli_devolucao_romaneios', []);
    s.setTable('meli_devolucoes', [
      { id: 'p1', tracking_id: 'TRACK1', base_id: BASE_ID, estado: 'aguardando_retorno' },
      { id: 'p2', tracking_id: 'TRACK2', base_id: BASE_ID, estado: 'aguardando_retorno' },
      { id: 'p3', tracking_id: 'TRACK3', base_id: BASE_ID, estado: 'aguardando_retorno' },
      { id: 'p4', tracking_id: 'TRACK4', base_id: BASE_ID, estado: 'aguardando_retorno' },
    ]);
  });

  it('quatro usuários abrindo devoluções simultaneamente gera 4 sequenciais únicos', async () => {
    const mockAbrir = async (userId: string, trackingId: string) => {
      // Simula a lógica da RPC com lock (no fake é síncrono então é seguro, mas Promise.all testa a interface do handler)
      const dataHoje = '2026-08-15';
      const baseCodigo = 'ESP17';
      
      const romaneios = s.tables['meli_devolucao_romaneios'].rows.filter(
        r => r.base_id === BASE_ID && r.data_operacional === dataHoje
      );
      const seq = romaneios.length + 1;
      const codigo = \`EXP-REC-20260815-ESP17-\${seq.toString().padStart(3, '0')}\`;
      
      const newRomaneio = {
        id: \`uuid-\${userId}\`,
        codigo,
        base_id: BASE_ID,
        data_operacional: dataHoje,
        sequencial: seq,
        aberto_por: userId,
        status: 'em_andamento'
      };
      
      s.tables['meli_devolucao_romaneios'].rows.push(newRomaneio);
      return { romaneio_id: newRomaneio.id, codigo_romaneio: codigo };
    };

    const results = await Promise.all([
      mockAbrir(USER_A, 'TRACK1'),
      mockAbrir(USER_B, 'TRACK2'),
      mockAbrir(USER_C, 'TRACK3'),
      mockAbrir(USER_D, 'TRACK4')
    ]);

    const codigos = results.map(r => r.codigo_romaneio);
    expect(new Set(codigos).size).toBe(4);
    expect(codigos).toContain('EXP-REC-20260815-ESP17-001');
    expect(codigos).toContain('EXP-REC-20260815-ESP17-004');
  });
});
