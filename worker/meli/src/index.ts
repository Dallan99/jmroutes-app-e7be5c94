// Loop principal do worker (Fase B1 — piloto ESP16/SSP15/MLB).
// Sem setInterval: executa o ciclo, registra telemetria, aguarda o intervalo
// e só então inicia o próximo ciclo (nunca há sobreposição).
import { loadConfig, ConfigError, WORKER_VERSAO, type WorkerConfig } from "./config.js";
import { logger } from "./logger.js";
import { sleep } from "./meli/list.js";
import { novoEstadoIncremental } from "./meli/active-filter.js";
import { CircuitBreaker } from "./state/breaker.js";
import { abrirSessaoAdminML, garantirSessaoJmroutes, type JmrSessao } from "./pipeline/auth.js";
import { executarCiclo } from "./pipeline/cycle.js";
import { sincronizarDevolucoes } from "./pipeline/devolucoes.js";
import { registrarExecucao, type Execucao } from "./telemetry/report.js";
import {
  abandonarCicloRemoto,
  dataOperacionalBrt,
  estadoParaFinalizacao,
  finalizarCicloRemoto,
  iniciarCicloRemoto,
} from "./pipeline/ciclo-lote.js";
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
    protocolo_lotes: cfg.protocoloLotes,
  });

  if (!cfg.protocoloLotes) {
    logger.info(
      "Protocolo de lotes DESLIGADO (SYNC_PROTOCOL_LOTES != true): fluxo de ingestão atual preservado.",
    );
  }

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
      // ── Protocolo de lotes (feature flag) ───────────────────────────────
      // Off (default) => syncBatchId nulo => endpoint legado, comportamento atual.
      const dataOperacional = dataOperacionalBrt();
      let syncBatchId: string | null = null;
      if (cfg.protocoloLotes) {
        const candidato = randomUUID();
        const abertura = await iniciarCicloRemoto(
          cfg,
          { syncBatchId: candidato, dataOperacional },
          { accessToken: jmr.accessToken },
        );
        if (abertura.status === "ok") syncBatchId = candidato;
      }

      let resultado = await executarCiclo({
        cfg,
        transport: sessao.transport,
        accessToken: jmr.accessToken,
        breaker,
        estado,
        syncBatchId,
      });

      // Backend ainda sem a migration: abandona o ciclo e repete no fluxo legado.
      if (resultado.protocoloLotesIndisponivel && syncBatchId) {
        await abandonarCicloRemoto(
          cfg,
          { syncBatchId, mensagem: "protocolo_indisponivel" },
          { accessToken: jmr.accessToken },
        );
        syncBatchId = null;
        resultado = await executarCiclo({
          cfg,
          transport: sessao.transport,
          accessToken: jmr.accessToken,
          breaker,
          estado,
          syncBatchId: null,
        });
      }

      if (syncBatchId) {
        await finalizarCicloRemoto(
          cfg,
          {
            syncBatchId,
            dataOperacional,
            rotas: resultado.execucao.rotas_processadas,
            pacotes: null,
            estado: estadoParaFinalizacao(resultado.execucao.status, resultado.execucao.erros),
            mensagem: resultado.execucao.mensagem_segura,
          },
          { accessToken: jmr.accessToken },
        );
      }

      await registrarExecucao(cfg, resultado.execucao, { accessToken: jmr.accessToken });
      if (resultado.execucao.status === "sucesso") {
        const devolucoes = await sincronizarDevolucoes(cfg, jmr.accessToken);
        if (devolucoes.status === "ok") {
          logger.info("Devoluções sincronizadas no ciclo da base.", {
            base: cfg.baseCode,
            criadas: Number(devolucoes.resultado["criadas"] ?? devolucoes.resultado["criados"] ?? 0),
            atualizadas: Number(devolucoes.resultado["atualizadas"] ?? devolucoes.resultado["atualizados"] ?? 0),
            revisao: Number(devolucoes.resultado["revisao_necessaria"] ?? 0),
          });
        } else {
          if (devolucoes.status === "sem_sessao") jmr = null;
          logger.warn("Sincronização automática de Devoluções será repetida no próximo ciclo.", {
            base: cfg.baseCode,
            motivo: devolucoes.status === "erro" ? devolucoes.motivo : "sem_sessao",
          });
        }
      }
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
