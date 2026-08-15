import { describe, it, expect, beforeEach } from 'vitest';
import { classificarOcorrencia, calcularPrazoRetorno } from '../../src/lib/meli-devolucoes-domain';

describe('Devoluções Domain Logic', () => {
  it('deve classificar ocorrências de retorno corretamente', () => {
    expect(classificarOcorrencia('buyer_absent')).toBe('retorno_obrigatorio');
    expect(classificarOcorrencia('buyer_rejected')).toBe('retorno_obrigatorio');
    expect(classificarOcorrencia('missing')).toBe('investigacao');
    expect(classificarOcorrencia('transferred')).toBe('transferencia');
    expect(classificarOcorrencia('unknown_code')).toBe('revisao_necessaria');
  });

  it('deve calcular o prazo de retorno de 3 dias', () => {
    const ocorrido = new Date('2026-08-15T10:00:00Z');
    const prazo = calcularPrazoRetorno(ocorrido);
    const diffDays = (prazo.getTime() - ocorrido.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(3);
  });
});
