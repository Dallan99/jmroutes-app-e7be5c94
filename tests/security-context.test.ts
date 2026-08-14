import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock do Supabase
const mockSupabase = {
  rpc: vi.fn(),
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase
}));

// Mock do middleware
vi.mock('@/integrations/supabase/auth-middleware', () => ({
  requireSupabaseAuth: (fn: any) => fn
}));

import { 
  meliDevolucoesCriarDevolucao, 
  meliDevolucoesBipar,
  meliDevolucoesListar
} from '../src/lib/meli-devolucoes.functions';

describe('Meli Devoluções Security Context (Simulated)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve chamar a RPC de criar devolução com os parâmetros corretos', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: { status: 'ok', romaneio_id: '123' }, error: null });
    
    const result = await meliDevolucoesCriarDevolucao({ 
      data: { base_id: 'base-uuid', tracking_id: 'ML123' } 
    } as any);

    expect(mockSupabase.rpc).toHaveBeenCalledWith('meli_romaneio_abrir_com_primeiro_pacote', {
      p_base_id: 'base-uuid',
      p_tracking_id: 'ML123',
      p_observacao: null
    });
    expect(result.status).toBe('ok');
  });

  it('deve chamar a RPC de bipar com observação', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: { status: 'ok' }, error: null });
    
    await meliDevolucoesBipar({ 
      data: { 
        romaneio_id: 'rom-uuid', 
        base_id: 'base-uuid', 
        tracking_id: 'ML123',
        observacao: 'Pacote amassado'
      } 
    } as any);

    expect(mockSupabase.rpc).toHaveBeenCalledWith('meli_romaneio_bipar', {
      p_romaneio_id: 'rom-uuid',
      p_base_id: 'base-uuid',
      p_tracking_id: 'ML123',
      p_observacao: 'Pacote amassado'
    });
  });
});
