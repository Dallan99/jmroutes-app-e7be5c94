// Um ciclo de sincronização: lista -> seleção -> detalhe -> envio -> telemetria.
// Concorrência 1, jitter entre chamadas, sem sobreposição de ciclos.
import { randomUUID } from "node:crypto";
import { ADMINML, type WorkerConfig } from "../config";
import { logger, mensagemSegura } from "../logger";
import { jitter, listarRotas, sleep, type MeliTransport } from "../meli/list";
import { obterDetalheRota } from "../meli/detail";
import {
  novoEstadoIncremental,
  registrarColeta,
  selecionarRotas,
  type EstadoIncremental,
} from "../meli/active-filter";
import type { CircuitBreaker } from "../state/breaker";
import { enviarRotaBruta } from "./send";
import type { CicloStatus, Execucao, SessaoStatusTelemetria } from "../telemetry/report";

export type CicloDeps = {
  cfg: WorkerConfig;
  transport: MeliTransport;
  accessToken: string;
  breaker: CircuitBreaker;
  estado?: EstadoIncremental;
  dormir?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
  maxRotasPorCiclo?: number;
};

export type CicloResultado = {
  execucao: Execucao;
  /** Sinaliza ao loop que a sessão AdminML precisa de reautenticação manual. */
  sessaoAdminMLExpirada: boolean;
  /** Sinaliza ao loop que a sessão JMRoutes precisa ser renovada. */
  jmroutesSemSessao: boolean;
};

function montar(
  cfg: WorkerConfig,
  inicio: number,
  batchId: string,
  status: CicloStatus,
  sessao: SessaoStatusTelemetria,
  parciais: Partial<Execucao> = {},
): Execucao {
  const fim = Date.now();
  return {
    base_code: cfg.baseCode,
    sync_batch_id: batchId,
    iniciado_em: new Date(inicio).toISOString(),
    finalizado_em: new Date(fim).toISOString(),
    duracao_ms: fim - inicio,
    rotas_encontradas: 0,
    rotas_processadas: 0,
    pacotes_enviados: 0,
    erros: 0,
    status,
    sessao_status: sessao,
    mensagem_segura: null,
    ...parciais,
  };
}

export async function executarCiclo(deps: CicloDeps): Promise<CicloResultado> {
  const { cfg, transport, breaker } = deps;
  const dormir = deps.dormir ?? sleep;
  const estado = deps.estado ?? novoEstadoIncremental();
  const batchId = randomUUID();
  const inicio = Date.now();

  if (!breaker.permite()) {
    return {
      execucao: montar(cfg, inicio, batchId, "circuito_pausado", "ok", {
        mensagem_segura: mensagemSegura(`circuito aberto: ${breaker.motivo ?? "desconhecido"}`),
      }),
      sessaoAdminMLExpirada: false,
      jmroutesSemSessao: false,
    };
  }

  const lista = await listarRotas(transport, {
    serviceCenterId: cfg.serviceCenterId,
    siteId: cfg.siteId,
    dormir,
  });

  if (!lista.ok) {
    if (lista.motivo === "sessao_expirada") {
      breaker.abrir("sessao_expirada");
      return {
        execucao: montar(cfg, inicio, batchId, "sessao_expirada", "expirada", {
          mensagem_segura: "AdminML retornou 401/403 na lista; aguardando nova autenticação manual.",
        }),
        sessaoAdminMLExpirada: true,
        jmroutesSemSessao: false,
      };
    }
    breaker.registrarFalha(lista.motivo);
    return {
      execucao: montar(
        cfg,
        inicio,
        batchId,
        lista.motivo === "rate_limit" ? "rate_limit" : "erro",
        "ok",
        { erros: 1, mensagem_segura: mensagemSegura(`falha na lista: ${lista.motivo}`) },
      ),
      sessaoAdminMLExpirada: false,
      jmroutesSemSessao: false,
    };
  }

  const encontradas = lista.valor.rotas.length;
  const selecionadas = selecionarRotas(lista.valor.rotas, estado).slice(
    0,
    deps.maxRotasPorCiclo ?? 500,
  );

  let processadas = 0;
  let pacotes = 0;
  let erros = 0;
  let rateLimit = false;
  let sessaoExpirada = false;
  let semSessaoJmr = false;
  let ultimaMensagem: string | null = null;

  // Concorrência 1 — sequencial, com jitter entre chamadas.
  for (const rota of selecionadas) {
    if (sessaoExpirada || semSessaoJmr) break;

    const detalhe = await obterDetalheRota(transport, rota.routeId, cfg.siteId, dormir);
    if (!detalhe.ok) {
      if (detalhe.motivo === "sessao_expirada") {
        sessaoExpirada = true;
        breaker.abrir("sessao_expirada");
        break;
      }
      erros += 1;
      if (detalhe.motivo === "rate_limit") rateLimit = true;
      ultimaMensagem = `detalhe ${rota.routeId}: ${detalhe.motivo}`;
      await dormir(jitter());
      continue;
    }

    const envio = await enviarRotaBruta(cfg, detalhe.valor, {
      accessToken: deps.accessToken,
      fetchImpl: deps.fetchImpl,
    });

    if (envio.status === "ok") {
      processadas += 1;
      pacotes += envio.pacotes;
      registrarColeta(estado, rota);
    } else if (envio.status === "sem_sessao") {
      semSessaoJmr = true;
      ultimaMensagem = "sessão JMRoutes expirada durante o envio.";
      break;
    } else if (envio.status === "rate_limit") {
      rateLimit = true;
      erros += 1;
      await dormir(60_000);
    } else {
      erros += 1;
      ultimaMensagem = envio.mensagem;
    }

    await dormir(jitter(ADMINML.JITTER_MS));
  }

  let status: CicloStatus;
  if (semSessaoJmr) status = "jmroutes_sem_sessao";
  else if (sessaoExpirada) status = "sessao_expirada";
  else if (rateLimit && processadas === 0) status = "rate_limit";
  else if (erros > 0 && processadas > 0) status = "sucesso_parcial";
  else if (erros > 0) status = "erro";
  else status = "sucesso";

  if (status === "sucesso" || status === "sucesso_parcial") breaker.registrarSucesso();
  else if (status === "erro" || status === "rate_limit") breaker.registrarFalha(status);

  logger.info("Ciclo processado.", { base: cfg.baseCode, encontradas, processadas, erros });

  return {
    execucao: montar(cfg, inicio, batchId, status, sessaoExpirada ? "expirada" : "ok", {
      rotas_encontradas: encontradas,
      rotas_processadas: processadas,
      pacotes_enviados: pacotes,
      erros,
      mensagem_segura: ultimaMensagem ? mensagemSegura(ultimaMensagem) : null,
    }),
    sessaoAdminMLExpirada: sessaoExpirada,
    jmroutesSemSessao: semSessaoJmr,
  };
}
