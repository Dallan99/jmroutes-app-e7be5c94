import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks manuais antes da importação
vi.mock('@tanstack/react-start', () => {
  const handlerMock = (options: any) => ({
    handler: options.handler,
    validator: () => handlerMock(options)
  });
  
  const createServerFn = (options: any) => {
    const obj = {
      handler: (h: any) => {
        const finalFn = (args: any) => h(args);
        (finalFn as any).handler = h;
        return finalFn;
      },
      validator: () => obj
    };
    return obj;
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
    
    // meliDevolucoesCriarDevolucao agora é a função final retornada por .handler()
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

  it('deve chamar a RPC de bipar com observação', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: { status: 'ok' }, error: null });
    
    await (meliDevolucoesBipar as any)({ 
      data: { 
        romaneio_id: 'rom-uuid', 
        base_id: 'base-uuid', 
        tracking_id: 'ML123',
        observacao: 'Pacote amassado'
      } 
    });

    expect(mockSupabase.rpc).toHaveBeenCalledWith('meli_romaneio_bipar', {
      p_romaneio_id: 'rom-uuid',
      p_base_id: 'base-uuid',
      p_tracking_id: 'ML123',
      p_observacao: 'Pacote amassado'
    });
  });
});
