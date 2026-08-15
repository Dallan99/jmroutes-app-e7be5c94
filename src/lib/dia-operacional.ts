// Dia operacional padrão das telas: sempre o dia atual em America/Sao_Paulo,
// exceto quando o usuário escolheu outra data explicitamente NESTA sessão.

const TZ = "America/Sao_Paulo";

/** Data de hoje (YYYY-MM-DD) no fuso America/Sao_Paulo — sem depender do fuso do host. */
export function hojeOperacional(agora: Date = new Date()): string {
  // Ajusta a data do sistema para o fuso de São Paulo antes de formatar
  // O construtor de Date() no sandbox/worker pode estar em UTC ou outro fuso.
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  
  // Para garantir consistência entre o que o DB entende como (now() AT TIME ZONE 'TZ')::date
  // e o que o JS gera, usamos Intl.DateTimeFormat com o fuso fixo.
  return f.format(agora); 
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
