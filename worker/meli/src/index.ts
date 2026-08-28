// Worker local multibase. Executa sequencialmente para preservar a sessão do
// AdminML e nunca sobrepor ciclos.
import { randomUUID } from "node:crypto";
import { ConfigError, configParaBase, loadConfig, WORKER_VERSAO, type WorkerConfig } from "./config.js";
import { logger } from "./logger.js";
import { novoEstadoIncremental } from "./meli/active-filter.js";
import { sleep } from "./meli/list.js";
import { abrirSessaoAdminML, garantirSessaoJmroutes, type JmrSessao } from "./pipeline/auth.js";
import { autenticarManualmenteCoordenado } from "./session/login.js";
import { executarCiclo } from "./pipeline/cycle.js";
import { sincronizarDevolucoes } from "./pipeline/devolucoes.js";
import { CircuitBreaker } from "./state/breaker.js";
import { registrarExecucao, type Execucao } from "./telemetry/report.js";

let encerrando = false;

for (const sinal of ["SIGINT", "SIGTERM"] as const) {
  process.on(sinal, () => {
    encerrando = true;
    logger.info("Encerramento solicitado; finalizando após o ciclo atual.", { sinal });
  });
}

function execucaoVazia(cfg: WorkerConfig, status: Execucao["status"], msg: string): Execucao {
  const agora = new Date().toISOString();
  return {
    base_code: cfg.baseCode,
    sync_batch_id: randomUUID(),
    iniciado_em: agora,
    finalizado_em: agora,
    duracao_ms: 0,
    rotas_encontradas: 0,
    rotas_processadas: 0,
    pacotes_enviados: 0,
    erros: 0,
    status,
    sessao_status: status === "aguardando_autenticacao" ? "ausente" : "ok",
    mensagem_segura: msg,
  };
}

async function main() {
  let cfg: WorkerConfig;
  try {
    cfg = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.error("Configuração inválida — worker não iniciado.", { erro: err.message });
      process.exit(2);
    }
    throw err;
  }

  logger.info("Worker Meli local iniciado.", {
    versao: WORKER_VERSAO,
    bases: cfg.bases.map((b) => b.baseCode),
    bases_com_escrita: cfg.writeBaseCodes,
    intervalo_s: cfg.syncIntervalSeconds,
    dry_run: cfg.dryRun,
  });

  const breakers = new Map(cfg.bases.map((b) => [b.baseCode, new CircuitBreaker()]));
  const estados = new Map(cfg.bases.map((b) => [b.baseCode, novoEstadoIncremental()]));
  let jmr: JmrSessao | null = null;

  while (!encerrando) {
    if (!cfg.dryRun) {
      const auth = await garantirSessaoJmroutes(cfg, jmr);
      if (auth.status !== "ok") {
        jmr = null;
        logger.warn("Sem sessão JMRoutes; ciclo não executado.", { motivo: auth.motivo });
        await registrarExecucao(cfg, execucaoVazia(cfg, "jmroutes_sem_sessao", `sem sessão JMRoutes: ${auth.motivo}`), { accessToken: null });
        await sleep(cfg.syncIntervalSeconds * 1000);
        continue;
      }
      jmr = auth.sessao;
    }

    let sessao;
    let precisaReautenticarAdminML = false;
    try {
      sessao = await abrirSessaoAdminML(cfg);
    } catch (err) {
      logger.warn("Não foi possível abrir o AdminML; nova tentativa será feita.", { erro: String((err as Error)?.message ?? err) });
      await sleep(Math.max(cfg.syncIntervalSeconds, 60) * 1000);
      continue;
    }

    if (sessao.status !== "ok") {
      logger.warn("Aguardando autenticação manual do AdminML.", { motivo: sessao.motivo });
      if (!cfg.dryRun && jmr) {
        await registrarExecucao(cfg, execucaoVazia(cfg, "aguardando_autenticacao", `sessão AdminML indisponível: ${sessao.motivo}`), { accessToken: jmr.accessToken });
      }
      try {
        await autenticarManualmenteCoordenado({
          sessionFilePath: cfg.sessionFilePath,
          sessionKeyBase64: cfg.sessionKeyBase64,
          timeoutMs: 10 * 60_000,
        });
        logger.info("Sessão AdminML recuperada; retomando os ciclos.");
      } catch (err) {
        logger.warn("Recuperação assistida do AdminML não foi concluída.", {
          erro: String((err as Error)?.message ?? err),
        });
        await sleep(Math.max(cfg.syncIntervalSeconds, 300) * 1000);
      }
      continue;
    }

    try {
      for (const base of cfg.bases) {
        if (encerrando) break;
        const cfgBase = configParaBase(cfg, base);
        const somenteValidacao = cfg.dryRun || !cfg.writeBaseCodes.includes(base.baseCode);
        const resultado = await executarCiclo({
          cfg: cfgBase,
          transport: sessao.transport,
          accessToken: jmr?.accessToken ?? "",
          breaker: breakers.get(base.baseCode)!,
          estado: estados.get(base.baseCode)!,
          dryRun: somenteValidacao,
        });

        logger.info(somenteValidacao ? "Validação da base concluída." : "Ciclo da base concluído.", {
          base: base.baseCode,
          status: resultado.execucao.status,
          motivo: resultado.execucao.mensagem_segura,
          ...resultado.resumo,
        });

        if (!somenteValidacao && jmr) {
          await registrarExecucao(cfgBase, resultado.execucao, { accessToken: jmr.accessToken });
          if (resultado.execucao.status === "sucesso" || resultado.execucao.status === "sucesso_parcial") {
            const devolucoes = await sincronizarDevolucoes(cfgBase, jmr.accessToken);
            if (devolucoes.status !== "ok") {
              logger.warn("Sincronização de devoluções será repetida.", {
                base: base.baseCode,
                motivo: devolucoes.status === "erro" ? devolucoes.motivo : "sem_sessao",
              });
            }
          }
        }

        if (resultado.jmroutesSemSessao) jmr = null;
        if (resultado.sessaoAdminMLExpirada) {
          precisaReautenticarAdminML = true;
          break;
        }
        if (resultado.jmroutesSemSessao) break;
      }
    } finally {
      await sessao.fechar();
    }

    if (precisaReautenticarAdminML && !encerrando) {
      try {
        await autenticarManualmenteCoordenado({
          sessionFilePath: cfg.sessionFilePath,
          sessionKeyBase64: cfg.sessionKeyBase64,
          timeoutMs: 10 * 60_000,
        });
        logger.info("Sessão AdminML recuperada; retomando os ciclos.");
      } catch (err) {
        logger.warn("Recuperação assistida do AdminML não foi concluída.", {
          erro: String((err as Error)?.message ?? err),
        });
      }
    }

    if (!encerrando) await sleep(cfg.syncIntervalSeconds * 1000);
  }

  logger.info("Worker Meli local encerrado.");
}

main().catch((err) => {
  logger.error("Falha fatal no worker.", { erro: String((err as Error)?.message ?? err) });
  process.exit(1);
});
