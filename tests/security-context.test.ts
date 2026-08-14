import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks manuais antes de importar qualquer coisa do projeto
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    validator: () => ({
      handler: (h: any) => {
        // Retorna uma função que chama o handler com os argumentos mockados
        return async (args: any) => await h(args);
      }
    })
  })
}));

const mockSupabase = {
  rpc: vi.fn(),
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase
}));

// Agora importa as funções a serem testadas
import { 
  meliDevolucoesCriarDevolucao, 
  meliDevolucoesBipar
} from '../src/lib/meli-devolucoes.functions';

describe('Meli Devoluções Security Context (Simulated)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve chamar a RPC de criar devolução com os parâmetros corretos', async () => {
    // Definimos o comportamento do mock explicitamente aqui
    mockSupabase.rpc.mockImplementation((name: string) => {
      if (name === 'meli_romaneio_abrir_com_primeiro_pacote') {
        return Promise.resolve({ 
          data: { status: 'ok', romaneio_id: '123', codigo_romaneio: 'EXP-123' }, 
          error: null 
        });
      }
      return Promise.resolve({ data: null, error: new Error('not mocked') });
    });
    
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
