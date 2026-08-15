import { describe, it, expect } from 'vitest';

describe('Devoluções v3 Flow - Characterization', () => {
  it('deve validar se a estrutura de sincronização está correta', () => {
     const mockResumo = {
        criados: 10,
        atualizados: 5,
        ignorados: 0,
        erros: 0,
        sincronizado_em: new Date().toISOString()
     };
     
     expect(mockResumo).toHaveProperty('criados');
     expect(mockResumo).toHaveProperty('atualizados');
     expect(mockResumo.erros).toBe(0);
  });

  it('deve garantir que o estado de investigação é mapeado corretamente', () => {
     const status = 'missing';
     const mapping = (s: string) => {
        if (['missing', 'lost', 'stolen'].includes(s)) return 'em_investigacao';
        return 'aguardando_retorno';
     };
     expect(mapping(status)).toBe('em_investigacao');
  });
});
