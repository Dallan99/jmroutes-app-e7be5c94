import { describe, it, expect, beforeEach, vi } from 'vitest';
import { meliDevolucoesSincronizar } from '../../src/lib/meli-devolucoes.functions';

// Mock do Supabase
const mockRpc = vi.fn();
const mockSupabase = {
  rpc: mockRpc
};

describe('Devoluções Sync v2 - Sandbox Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve chamar a assinatura compatível com os parâmetros corretos', async () => {
    const dataDe = '2026-08-01';
    const dataAte = '2026-08-15';
    const baseId = '550e8400-e29b-41d4-a716-446655440000';

    mockRpc.mockResolvedValue({
      data: {
        status: 'ok',
        analisados: 100,
        criados: 10,
        atualizados: 5,
        sem_alteracao: 80,
        erros: 5
      },
      error: null
    });

    // Injetamos o mock no contexto via middleware (simulação manual para teste unitário do wrapper)
    const result = await meliDevolucoesSincronizar({ 
      data: { data_de: dataDe, data_ate: dataAte, base_id: baseId },
      context: { supabase: mockSupabase } as any 
    });

    expect(mockRpc).toHaveBeenCalledWith('meli_devolucoes_sincronizar', {
      p_data_de: dataDe,
      p_data_ate: dataAte,
      p_base_id: baseId
    });
    
    expect(result.criados).toBe(10);
  });

  it('deve validar a lógica de classificação de prazos (Simulação)', () => {
    const classificar = (codigo: string) => {
      const eleg = ['buyer_rejected', 'buyer_absent'];
      const inv = ['missing', 'lost'];
      if (eleg.includes(codigo)) return { estado: 'aguardando', prazo: 3 };
      if (inv.includes(codigo)) return { estado: 'investigacao', prazo: null };
      return { estado: 'revisao', prazo: null };
    };

    expect(classificar('buyer_rejected').prazo).toBe(3);
    expect(classificar('missing').prazo).toBeNull();
    expect(classificar('unknown').prazo).toBeNull();
  });

  it('deve validar fallback de horário (Simulação)', () => {
    const getHorario = (finishDate: string | null, detectadoEm: string) => {
      return finishDate || detectadoEm;
    };
    
    expect(getHorario('2026-08-15T10:00:00Z', '2026-08-15T11:00:00Z')).toBe('2026-08-15T10:00:00Z');
    expect(getHorario(null, '2026-08-15T11:00:00Z')).toBe('2026-08-15T11:00:00Z');
  });
});
