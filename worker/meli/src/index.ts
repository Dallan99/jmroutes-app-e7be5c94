// Loop principal do worker (Fase B1 — piloto ESP16/SSP15/MLB).
// Sem setInterval: executa o ciclo, registra telemetria, aguarda o intervalo
// e só então inicia o próximo ciclo (nunca há sobreposição).
import { loadConfig, ConfigError, WORKER_VERSAO, type WorkerConfig } from "./config";
import { logger } from "./logger";
import { sleep } from "./meli/list";
import { novoEstadoIncremental } from "./meli/active-filter";
import { CircuitBreaker } from "./state/breaker";
import { abrirSessaoAdminML, garantirSessaoJmroutes, type JmrSessao } from "./pipeline/auth";
import { executarCiclo } from "./pipeline/cycle";
import { registrarExecucao, type Execucao } from "./telemetry/report";
import { randomUUID } from "node:crypto";

let encerrando = false;

function agendarEncerramento() {
  for (const sinal of ["SIGINT", "SIGTERM"] as const) {
    process.on(sinal, () => {
      logger.info("Encerramento solicitado; finalizando após o ciclo atual.", { sinal });
      encerrando = true;
    });
  }
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
  agendarEncerramento();

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

  logger.info("Worker Meli iniciado.", {
    versao: WORKER_VERSAO,
    base: cfg.baseCode,
    service_center: cfg.serviceCenterId,
    site: cfg.siteId,
    intervalo_s: cfg.syncIntervalSeconds,
    dry_run: cfg.dryRun,
  });

  if (cfg.dryRun) {
    logger.info(
      "DRY_RUN ativo: consulta o AdminML, NÃO envia ao JMRoutes e NÃO grava telemetria.",
    );
  }

  const breaker = new CircuitBreaker();
  const estado = novoEstadoIncremental();
  let jmr: JmrSessao | null = null;

  while (!encerrando) {
    if (cfg.dryRun) {
      // Sem sessão AdminML válida NÃO tentamos login automático: apenas aguarda.
      const sessaoSeca = await abrirSessaoAdminML(cfg);
      if (sessaoSeca.status !== "ok") {
        logger.warn("DRY_RUN sem sessão AdminML; nenhuma ação executada.", {
          motivo: sessaoSeca.motivo,
        });
        await sleep(Math.max(cfg.syncIntervalSeconds, 300) * 1000);
        continue;
      }
      try {
        const r = await executarCiclo({
          cfg,
          transport: sessaoSeca.transport,
          accessToken: "",
          breaker,
          estado,
        });
        logger.info("DRY_RUN resumo do ciclo.", { ...r.resumo, status: r.execucao.status });
      } finally {
        await sessaoSeca.fechar();
      }
      if (encerrando) break;
      await sleep(cfg.syncIntervalSeconds * 1000);
      continue;
    }

    const auth = await garantirSessaoJmroutes(cfg, jmr);
    if (auth.status !== "ok") {
      jmr = null;
      logger.warn("Sem sessão JMRoutes; ciclo não executado.", { motivo: auth.motivo });
      await registrarExecucao(
        cfg,
        execucaoVazia(cfg, "jmroutes_sem_sessao", `sem sessão JMRoutes: ${auth.motivo}`),
        { accessToken: null },
      );
      await sleep(cfg.syncIntervalSeconds * 1000);
      continue;
    }
    jmr = auth.sessao;

    const sessao = await abrirSessaoAdminML(cfg);
    if (sessao.status !== "ok") {
      // Não entra em crash loop nem repete chamadas em sequência.
      logger.warn("Aguardando autenticação manual do AdminML.", { motivo: sessao.motivo });
      await registrarExecucao(
        cfg,
        execucaoVazia(cfg, "aguardando_autenticacao", `sessão AdminML indisponível: ${sessao.motivo}`),
        { accessToken: jmr.accessToken },
      );
      await sleep(Math.max(cfg.syncIntervalSeconds, 300) * 1000);
      continue;
    }

    try {
      const resultado = await executarCiclo({
        cfg,
        transport: sessao.transport,
        accessToken: jmr.accessToken,
        breaker,
        estado,
      });
      await registrarExecucao(cfg, resultado.execucao, { accessToken: jmr.accessToken });
      if (resultado.jmroutesSemSessao) jmr = null;
    } finally {
      await sessao.fechar();
    }

    if (encerrando) break;
    await sleep(cfg.syncIntervalSeconds * 1000);
  }

  logger.info("Worker Meli encerrado.");
}

main().catch((err) => {
  logger.error("Falha fatal no worker.", { erro: String((err as Error)?.message ?? err) });
  process.exit(1);
});
