import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks manuais ANTES de importar o módulo testado
vi.mock('@tanstack/react-start', () => {
  const createServerFn = () => {
    const builder = {
      validator: vi.fn().mockImplementation(() => builder),
      handler: vi.fn().mockImplementation((h) => {
        const fn = async (args: any) => {
           try {
             return await h(args);
           } catch (e: any) {
             // Simula o comportamento do cliente RPC do Supabase que retorna {data, error}
             // Mas aqui como é server function, ela lança o erro.
             throw e;
           }
        };
        (fn as any).handler = h;
        return fn;
      })
    };
    return builder;
  };
  return { createServerFn };
});

const mockSupabase = {
  rpc: vi.fn(),
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase
}));

import { 
  meliDevolucoesCriarDevolucao, 
  meliDevolucoesBipar
} from '../src/lib/meli-devolucoes.functions';

describe('Meli Devoluções Security Context (Simulated)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve chamar a RPC de criar devolução com os parâmetros corretos', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: { status: 'ok', romaneio_id: '123' }, error: null });
    
    const result = await (meliDevolucoesCriarDevolucao as any)({ 
      data: { base_id: 'base-uuid', tracking_id: 'ML123' } 
    });

    expect(mockSupabase.rpc).toHaveBeenCalledWith('meli_romaneio_abrir_com_primeiro_pacote', {
      p_base_id: 'base-uuid',
      p_tracking_id: 'ML123',
      p_observacao: null
    });
    expect(result.status).toBe('ok');
  });

  it('deve simular falha de permissão se a RPC retornar erro', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ 
      data: null, 
      error: { message: 'permission denied', code: '42501' } 
    });
    
    await expect((meliDevolucoesBipar as any)({ 
      data: { 
        romaneio_id: 'rom-uuid', 
        base_id: 'base-uuid', 
        tracking_id: 'ML123'
      } 
    })).rejects.toMatchObject({ message: 'permission denied' });
  });
});
