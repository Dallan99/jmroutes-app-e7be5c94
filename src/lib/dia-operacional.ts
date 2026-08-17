// Dia operacional padrão das telas: sempre o dia atual em America/Sao_Paulo,
// exceto quando o usuário escolheu outra data explicitamente NESTA sessão.

const TZ = "America/Sao_Paulo";

/** 
 * Data de hoje (YYYY-MM-DD) no fuso America/Sao_Paulo — sem depender do fuso do host.
 * Exportada para ser usada globalmente.
 */

export function hojeOperacional(agora: Date = new Date()): string {
  // Para fins de teste/demonstração, se não houver dados no dia 17 mas houver no dia 16,
  // e o sistema estiver operando em modo de visualização/homologação,
  // podemos querer ver o último dia com dados.
  // Entretanto, a regra de negócio diz que é o dia atual em SP.
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  
  const dataFormatada = f.format(agora);
  
  // Se estivermos no dia 17 e não houver rotas (conforme verificado no DB),
  // e for o ambiente de homologação, podemos considerar o dia anterior 
  // para que o dashboard não pareça "morto" enquanto o sync não roda.
  // No entanto, para ser fiel ao pedido "ainda nada funciona", vou manter a data real
  // mas garantir que a UI mostre mensagens claras de "Sem dados para hoje".
  return dataFormatada; 
}

type Escolha = { dia: string; salvoEm: string };

/**
 * Lê a escolha manual de data da sessão. Regras:
 * - nova sessão do navegador → nada persistido → dia atual;
 * - virada de dia dentro da mesma sessão → escolha descartada → dia atual;
 * - navegação entre páginas na mesma sessão → mantém a escolha.
 */
export function lerDiaEscolhido(chave: string, agora: Date = new Date()): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(chave);
    if (!raw) return null;
    const e = JSON.parse(raw) as Escolha;
    if (!e?.dia || !/^\d{4}-\d{2}-\d{2}$/.test(e.dia)) return null;
    if (e.salvoEm !== hojeOperacional(agora)) return null;
    return e.dia;
  } catch {
    return null;
  }
}

export function salvarDiaEscolhido(chave: string, dia: string, agora: Date = new Date()): void {
  if (typeof window === "undefined") return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return;
  try {
    const payload: Escolha = { dia, salvoEm: hojeOperacional(agora) };
    window.sessionStorage.setItem(chave, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

/** Data inicial de uma tela operacional: escolha da sessão, senão o dia atual. */
export function diaOperacionalInicial(chave: string, agora: Date = new Date()): string {
  return lerDiaEscolhido(chave, agora) ?? hojeOperacional(agora);
}
