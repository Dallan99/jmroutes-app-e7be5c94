import { executarComRetry, type MeliTransport, type Resultado } from "./list.js";

const ROSTERING_DETAILS_URL =
  "https://envios.adminml.com/logistics/rostering/api/services/details";

export type LinhaRiscoRostering = {
  data: string;
  facility: string;
  cluster: string;
  transportadora: string;
  altoRisco: boolean;
  regiao: string | null;
  idServico: string | null;
};

type Registro = Record<string, unknown>;

const objeto = (valor: unknown): Registro | null =>
  valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Registro) : null;

const texto = (valor: unknown): string =>
  typeof valor === "string" || typeof valor === "number" ? String(valor).trim() : "";

function booleano(valor: unknown): boolean | null {
  if (typeof valor === "boolean") return valor;
  const normalizado = texto(valor).toLocaleLowerCase("pt-BR");
  if (["true", "1", "yes", "sim", "sí"].includes(normalizado)) return true;
  if (["false", "0", "no", "não", "nao"].includes(normalizado)) return false;
  return null;
}

/** Localiza a coleção de serviços mesmo se o AdminML alterar o envelope HTTP. */
export function extrairServicosRostering(body: unknown): Registro[] {
  const fila: unknown[] = [body];
  let guarda = 0;
  while (fila.length && guarda < 100) {
    guarda += 1;
    const atual = fila.shift();
    if (Array.isArray(atual)) {
      const candidatos = atual.map(objeto).filter((v): v is Registro => !!v);
      if (candidatos.some((v) => Array.isArray(v["assignments"]) && texto(v["startDate"]))) {
        return candidatos;
      }
      fila.push(...atual);
      continue;
    }
    const obj = objeto(atual);
    if (obj) fila.push(...Object.values(obj));
  }
  return [];
}

export function normalizarRiscoRostering(body: unknown): LinhaRiscoRostering[] {
  const linhas = new Map<string, LinhaRiscoRostering>();
  for (const servico of extrairServicosRostering(body)) {
    const data = texto(servico["startDate"]).slice(0, 10);
    const facility = texto(servico["facility"]);
    const transportadora = texto(servico["carrierName"]);
    const assignments = Array.isArray(servico["assignments"]) ? servico["assignments"] : [];
    for (const valor of assignments) {
      const assignment = objeto(valor);
      const planningRoute = objeto(assignment?.["planning_route"]);
      const metadata = objeto(planningRoute?.["metadata"]);
      const cluster = texto(metadata?.["original_route_name"]);
      const altoRisco = booleano(metadata?.["is_risky"]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !facility || !transportadora || !cluster || altoRisco === null) continue;
      const linha: LinhaRiscoRostering = {
        data,
        facility,
        cluster,
        transportadora,
        altoRisco,
        regiao: texto(metadata?.["region"]) || null,
        idServico: texto(assignment?.["ID"]) || null,
      };
      linhas.set([data, facility, cluster, transportadora].join("|"), linha);
    }
  }
  return [...linhas.values()];
}

export async function listarRiscoSemanal(
  transport: MeliTransport,
  inicio: string,
  fim: string,
): Promise<Resultado<LinhaRiscoRostering[]>> {
  const params = new URLSearchParams({
    startDate: inicio,
    endDate: fim,
    stepType: "last-mile",
    channel: "mlp",
  });
  const resposta = await executarComRetry(
    () => transport.get(`${ROSTERING_DETAILS_URL}?${params}`, { loadType: "export" }),
    { tentativas: 3 },
  );
  if (!resposta.ok) return resposta;
  const linhas = normalizarRiscoRostering(resposta.valor.body);
  if (!linhas.length) return { ok: false, motivo: "payload_shape", status: resposta.valor.status };
  return { ok: true, valor: linhas };
}

export function semanaAtual(agora = new Date()): { inicio: string; fim: string } {
  const data = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate()));
  const deslocamento = (data.getUTCDay() + 6) % 7;
  data.setUTCDate(data.getUTCDate() - deslocamento);
  const fim = new Date(data);
  fim.setUTCDate(fim.getUTCDate() + 6);
  return { inicio: data.toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10) };
}
