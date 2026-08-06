// Circuit breaker simples por base/fonte.
export type BreakerEstado = "fechado" | "aberto";

export type BreakerOpts = {
  limiteFalhas?: number;
  cooldownMs?: number;
};

export class CircuitBreaker {
  private falhas = 0;
  private abertoAte = 0;
  private readonly limite: number;
  private readonly cooldown: number;
  motivo: string | null = null;

  constructor(opts: BreakerOpts = {}) {
    this.limite = opts.limiteFalhas ?? 3;
    this.cooldown = opts.cooldownMs ?? 5 * 60_000;
  }

  get estado(): BreakerEstado {
    return Date.now() < this.abertoAte ? "aberto" : "fechado";
  }

  permite(agora = Date.now()): boolean {
    if (agora >= this.abertoAte) {
      if (this.abertoAte !== 0) {
        this.abertoAte = 0;
        this.falhas = 0;
        this.motivo = null;
      }
      return true;
    }
    return false;
  }

  registrarSucesso(): void {
    this.falhas = 0;
    this.abertoAte = 0;
    this.motivo = null;
  }

  registrarFalha(motivo: string, agora = Date.now()): void {
    this.falhas += 1;
    this.motivo = motivo;
    if (this.falhas >= this.limite) this.abrir(motivo, this.cooldown, agora);
  }

  /** Abertura imediata (usada em 401/403 — sem novas tentativas). */
  abrir(motivo: string, duracaoMs = this.cooldown, agora = Date.now()): void {
    this.motivo = motivo;
    this.abertoAte = agora + duracaoMs;
  }

  restanteMs(agora = Date.now()): number {
    return Math.max(0, this.abertoAte - agora);
  }
}
