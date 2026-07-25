// JM Routes Importador — service worker.
// - Captura de rota única via chrome.debugger (fallback do popup — código existente).
// - Sincronização em lote e modo contínuo (30 s) de todas as rotas ativas da base do Meli.
// - Não persiste payloads, tokens, cookies ou dados pessoais.
//   chrome.storage guarda apenas configurações e estatísticas agregadas do último ciclo.

self.addEventListener("install", () => { self.skipWaiting?.(); });
self.addEventListener("activate", () => { self.clients?.claim?.(); });

// ============================================================
// Config e constantes
// ============================================================
const JMROUTES_ORIGIN = "https://jmroutes.app";
const IMPORT_ENDPOINT = JMROUTES_ORIGIN + "/api/public/meli/importar-rota-bruta";
const SUPABASE_PROJECT_REF = "ieqvzndvkzozqvseubuc";
const SB_STORAGE_KEY = "sb-" + SUPABASE_PROJECT_REF + "-auth-token";
const MELI_HOST = "envios.adminml.com";
const MELI_LIST_PATH_RE = /^\/logistics\/monitoring-distribution\/?$/;
const MELI_DETAIL_PATH_RE = /^\/logistics\/monitoring-distribution\/detail\/(\d+)\/?$/;

const CYCLE_INTERVAL_MS = 30_000;
const MAX_ROTAS = 500;
const MAX_PAGINAS = 20;
const DEFAULT_CONCURRENCY = 4;
const ITEM_SPACING_MS = 250;
const DETAIL_TIMEOUT_MS = 30_000;
const LIST_TIMEOUT_MS = 30_000;
const SEND_TIMEOUT_MS = 60_000;

// ============================================================
// Estado em memória (não persistido)
// ============================================================
const state = {
  running: false,
  continuous: false,
  concurrency: DEFAULT_CONCURRENCY,
  cancelToken: 0,
  meliTabId: null,
  base: null,
  progress: {
    fase: "parado", // parado|descobrindo|listando|sincronizando|aguardando|pausado|cancelado
    encontradas: 0,
    ativas: 0,
    processadas: 0,
    sucesso: 0,
    divergencias: 0,
    erros: 0,
    pacotes_inseridos: 0,
    pacotes_atualizados: 0,
    pacotes_inalterados: 0,
    pacotes_invalidos: 0,
    atual: 0,
    total: 0,
    routeAtual: null,
    problemas: [], // [{routeId, motivo}]
    ultimaSync: null,
    proximaEm: null, // timestamp
    duracaoMs: null,
    mensagem: "",
  },
  backoffMs: 0,
};

// ============================================================
// Configuração persistida (não sensível)
// ============================================================
async function loadConfig() {
  try {
    const c = await chrome.storage.local.get(["continuous", "concurrency", "ultimaSync"]);
    if (typeof c.continuous === "boolean") state.continuous = c.continuous;
    if ([2, 4, 6].includes(c.concurrency)) state.concurrency = c.concurrency;
    if (typeof c.ultimaSync === "number") state.progress.ultimaSync = c.ultimaSync;
  } catch { /* ignore */ }
}
async function saveConfig() {
  try {
    await chrome.storage.local.set({
      continuous: state.continuous,
      concurrency: state.concurrency,
      ultimaSync: state.progress.ultimaSync,
    });
  } catch { /* ignore */ }
}

// ============================================================
// Notificação de progresso ao popup
// ============================================================
function broadcast() {
  chrome.runtime.sendMessage({ type: "jm/state", state: snapshot() }).catch(() => {});
}
function snapshot() {
  return {
    running: state.running,
    continuous: state.continuous,
    concurrency: state.concurrency,
    base: state.base,
    progress: { ...state.progress, problemas: state.progress.problemas.slice(-30) },
  };
}

// ============================================================
// Utilitários
// ============================================================
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function chromeAsync(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result);
    });
  });
}

// ============================================================
// Localização da aba do Meli (lista)
// ============================================================
async function findMeliListTab() {
  const tabs = await chrome.tabs.query({ url: `https://${MELI_HOST}/*` });
  // Preferência: aba com path de lista
  for (const t of tabs) {
    try {
      const u = new URL(t.url);
      if (u.hostname === MELI_HOST && MELI_LIST_PATH_RE.test(u.pathname)) return t;
    } catch { /* skip */ }
  }
  // Fallback: qualquer aba do host (o script tenta descobrir a URL de mesma forma)
  return tabs[0] || null;
}

// ============================================================
// Descoberta da URL real de get-routes-list e paginação
// ============================================================
function discoverListUrlInPage() {
  // roda no contexto da aba
  try {
    const entries = performance.getEntriesByType("resource") || [];
    let best = null;
    for (const e of entries) {
      const name = String(e.name || "");
      if (!name.includes("get-routes-list")) continue;
      if (!best || e.startTime > best.startTime) best = e;
    }
    if (!best) return { ok: false, reason: "no_entry" };
    return { ok: true, url: best.name };
  } catch (err) {
    return { ok: false, reason: "exception", message: String(err && err.message || err) };
  }
}

function fetchListInPage(listUrl) {
  // roda no contexto da aba do Meli
  return new Promise((resolve) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    fetch(listUrl, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json, text/plain, */*" },
      signal: ctrl.signal,
    }).then(async (r) => {
      clearTimeout(t);
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      if (!r.ok) { resolve({ ok: false, status: r.status }); return; }
      if (!ct.includes("json")) { resolve({ ok: false, reason: "content_type", status: r.status }); return; }
      try {
        const body = await r.json();
        resolve({ ok: true, body });
      } catch {
        resolve({ ok: false, reason: "parse" });
      }
    }).catch((e) => {
      clearTimeout(t);
      resolve({ ok: false, reason: e && e.name === "AbortError" ? "timeout" : "network" });
    });
  });
}

async function runInMeliTab(tabId, func, args) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func,
    args: args || [],
  });
  return res && res.result;
}

function detectPaginationStyle(url) {
  try {
    const u = new URL(url);
    const p = u.searchParams;
    if (p.has("page")) return { style: "page", pageKey: "page", sizeKey: p.has("size") ? "size" : (p.has("limit") ? "limit" : null) };
    if (p.has("offset")) return { style: "offset", offsetKey: "offset", sizeKey: p.has("size") ? "size" : (p.has("limit") ? "limit" : null) };
    if (p.has("from")) return { style: "from", offsetKey: "from", sizeKey: p.has("size") ? "size" : (p.has("limit") ? "limit" : null) };
    return { style: "unknown" };
  } catch {
    return { style: "unknown" };
  }
}

function extractRouteIdsFromListBody(body) {
  // Tenta várias formas comuns
  const buckets = [];
  const stack = [body];
  let visited = 0;
  while (stack.length && visited < 5000) {
    const cur = stack.pop();
    visited += 1;
    if (!cur || typeof cur !== "object") continue;
    if (Array.isArray(cur)) {
      // se todos itens forem objetos com id/routeId, considera bucket
      let looksLikeRoutes = 0;
      for (const it of cur.slice(0, 5)) {
        if (it && typeof it === "object" && (("id" in it) || ("routeId" in it) || ("route_id" in it))) looksLikeRoutes += 1;
      }
      if (looksLikeRoutes >= Math.min(cur.length, 3)) buckets.push(cur);
      for (const it of cur) stack.push(it);
      continue;
    }
    for (const k of Object.keys(cur)) {
      const v = cur[k];
      if (v && typeof v === "object") stack.push(v);
    }
  }
  const ids = [];
  const seen = new Set();
  const rawItems = [];
  for (const b of buckets) {
    for (const it of b) {
      const id = it && (it.id ?? it.routeId ?? it.route_id);
      if (id === undefined || id === null) continue;
      const s = String(id);
      if (!/^\d+$/.test(s)) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      ids.push(s);
      rawItems.push(it);
    }
  }
  return { ids, items: rawItems };
}

function readTotals(body) {
  const out = { totalDocuments: null, hasNext: null, last: null };
  const stack = [body];
  let visited = 0;
  while (stack.length && visited < 2000) {
    const cur = stack.pop();
    visited += 1;
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) continue;
    if (out.totalDocuments === null && typeof cur.totalDocuments === "number") out.totalDocuments = cur.totalDocuments;
    if (out.hasNext === null && typeof cur.hasNext === "boolean") out.hasNext = cur.hasNext;
    if (out.last === null && typeof cur.last === "boolean") out.last = cur.last;
    for (const k of Object.keys(cur)) {
      const v = cur[k];
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return out;
}

function detectBaseFromItems(items) {
  for (const it of items) {
    const cand = it?.serviceCenter?.name || it?.service_center?.name || it?.facility?.name || it?.origin?.name || it?.base?.name || it?.serviceCenterName;
    if (cand && typeof cand === "string") return cand;
  }
  return null;
}

function isRotaAtiva(item) {
  if (!item || typeof item !== "object") return true;
  const finishDate = Number(item.finishDate ?? item.finish_date ?? 0);
  const executedFinishDate = Number(item.executedFinishDate ?? item.executed_finish_date ?? 0);
  if (finishDate > 0) return false;
  if (executedFinishDate > 0) return false;
  const status = String(item.status || item.substatus || "").toLowerCase();
  const finalizados = ["finished", "finalizada", "finalizado", "completed", "cancelled", "canceled", "cancelada"];
  if (finalizados.some((s) => status.includes(s))) {
    const pending = Number(item?.counters?.pending ?? item?.counters?.pendingDelivery ?? -1);
    if (pending === 0) return false;
    if (pending < 0) return false;
  }
  return true;
}

// ============================================================
// Coleta paginada
// ============================================================
async function coletarLista(tabId) {
  const disc = await runInMeliTab(tabId, discoverListUrlInPage, []);
  if (!disc || !disc.ok) {
    return { ok: false, reason: "list_url_nao_encontrada" };
  }
  const baseUrl = new URL(disc.url);
  const pag = detectPaginationStyle(baseUrl.href);
  const allIds = [];
  const allItems = [];
  const seen = new Set();
  let page = 0;
  let offset = 0;
  const size = Number(baseUrl.searchParams.get("size") || baseUrl.searchParams.get("limit") || 50);
  let totalDocs = null;

  for (let i = 0; i < MAX_PAGINAS; i += 1) {
    const u = new URL(baseUrl.href);
    if (pag.style === "page") u.searchParams.set(pag.pageKey, String(page));
    else if (pag.style === "offset" || pag.style === "from") u.searchParams.set(pag.offsetKey, String(offset));

    const res = await runInMeliTab(tabId, fetchListInPage, [u.href]);
    if (!res || !res.ok) return { ok: false, reason: res?.reason || "list_http", status: res?.status };

    const body = res.body;
    const { ids, items } = extractRouteIdsFromListBody(body);
    const totals = readTotals(body);
    if (totalDocs === null && totals.totalDocuments !== null) totalDocs = totals.totalDocuments;

    let novos = 0;
    for (let k = 0; k < ids.length; k += 1) {
      if (seen.has(ids[k])) continue;
      seen.add(ids[k]);
      allIds.push(ids[k]);
      allItems.push(items[k]);
      novos += 1;
      if (allIds.length >= MAX_ROTAS) break;
    }
    if (allIds.length >= MAX_ROTAS) break;
    if (novos === 0) break;
    if (totals.hasNext === false) break;
    if (totals.last === true) break;
    if (totalDocs !== null && allIds.length >= totalDocs) break;
    if (pag.style === "page") page += 1;
    else if (pag.style === "offset" || pag.style === "from") offset += size;
    else break;
  }

  return { ok: true, ids: allIds, items: allItems, totalDocs };
}

// ============================================================
// Captura de detalhe (roda no contexto da aba)
// ============================================================
function fetchRouteDetailInPage(routeId) {
  return new Promise((resolve) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    const url = "https://envios.adminml.com/logistics/api/monitoring-route/route-detail?routeId=" +
      encodeURIComponent(String(routeId)) + "&siteId=MLB";
    fetch(url, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json, text/plain, */*" },
      signal: ctrl.signal,
    }).then(async (r) => {
      clearTimeout(t);
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      if (!r.ok) {
        const reason = (r.status === 401 || r.status === 403) ? "sessao_expirada"
          : r.status === 404 ? "not_found" : "http";
        resolve({ ok: false, status: r.status, reason });
        return;
      }
      if (!ct.includes("json")) { resolve({ ok: false, reason: "content_type" }); return; }
      try {
        const payload = await r.json();
        if (!payload || typeof payload !== "object" || !Array.isArray(payload.stops) || String(payload.id ?? "") !== String(routeId)) {
          resolve({ ok: false, reason: "payload_shape" });
          return;
        }
        resolve({ ok: true, payload });
      } catch {
        resolve({ ok: false, reason: "parse" });
      }
    }).catch((e) => {
      clearTimeout(t);
      resolve({ ok: false, reason: e && e.name === "AbortError" ? "timeout" : "network" });
    });
  });
}

// ============================================================
// Token do JMRoutes
// ============================================================
async function getJmroutesAccessToken() {
  const tabs = await chrome.tabs.query({ url: [JMROUTES_ORIGIN + "/*", "https://www.jmroutes.app/*"] });
  let tab = tabs[0];
  if (!tab) {
    tab = await chrome.tabs.create({ url: JMROUTES_ORIGIN + "/", active: false });
    await sleep(1500);
  }
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: (key) => {
        try {
          const raw = window.localStorage.getItem(key);
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          return parsed && parsed.access_token ? parsed.access_token : null;
        } catch { return null; }
      },
      args: [SB_STORAGE_KEY],
    });
    return res && res.result ? res.result : null;
  } catch {
    return null;
  }
}

async function enviarJmroutes(payload, token, signal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEND_TIMEOUT_MS);
  const abortLink = () => ctrl.abort();
  if (signal) signal.addEventListener("abort", abortLink);
  try {
    const r = await fetch(IMPORT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ payload, confirmar_divergencia: false }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    let body = null;
    try { body = await r.json(); } catch { body = null; }
    return { httpOk: r.ok, status: r.status, body };
  } catch (e) {
    clearTimeout(timer);
    return { httpOk: false, body: { ok: false, codigo: e && e.name === "AbortError" ? "timeout" : "rede" } };
  } finally {
    if (signal) signal.removeEventListener("abort", abortLink);
  }
}

// ============================================================
// Ciclo principal
// ============================================================
async function executarCiclo({ manual = false } = {}) {
  if (state.running) return { ok: false, reason: "ja_em_execucao" };
  state.running = true;
  state.cancelToken += 1;
  const myToken = state.cancelToken;
  const abortController = new AbortController();
  const isCancelled = () => myToken !== state.cancelToken;

  const t0 = Date.now();
  const prog = state.progress;
  Object.assign(prog, {
    fase: "descobrindo",
    encontradas: 0, ativas: 0, processadas: 0, sucesso: 0, divergencias: 0, erros: 0,
    pacotes_inseridos: 0, pacotes_atualizados: 0, pacotes_inalterados: 0, pacotes_invalidos: 0,
    atual: 0, total: 0, routeAtual: null, problemas: [], mensagem: "",
  });
  broadcast();

  try {
    const tab = await findMeliListTab();
    if (!tab) {
      prog.fase = "pausado";
      prog.mensagem = "Abra a página de rotas do Meli e recarregue.";
      broadcast();
      return { ok: false };
    }
    state.meliTabId = tab.id;

    prog.fase = "listando";
    broadcast();
    const lista = await coletarLista(tab.id);
    if (isCancelled()) { prog.fase = "cancelado"; broadcast(); return { ok: false }; }
    if (!lista.ok) {
      prog.fase = "pausado";
      prog.mensagem = lista.reason === "list_url_nao_encontrada"
        ? "Recarregue a página de rotas do Meli para descobrir a URL da lista."
        : "Falha ao obter a lista de rotas do Meli (" + (lista.reason || "erro") + ").";
      broadcast();
      return { ok: false };
    }
    prog.encontradas = lista.ids.length;
    state.base = detectBaseFromItems(lista.items) || state.base;

    // filtra ativas
    const ativos = [];
    for (let i = 0; i < lista.ids.length; i += 1) {
      if (isRotaAtiva(lista.items[i])) ativos.push(lista.ids[i]);
    }
    prog.ativas = ativos.length;
    prog.total = ativos.length;

    // Token JMRoutes (uma vez por ciclo)
    const token = await getJmroutesAccessToken();
    if (!token) {
      prog.fase = "pausado";
      prog.mensagem = "Faça login no JMRoutes e tente novamente.";
      state.continuous = false;
      await saveConfig();
      broadcast();
      return { ok: false };
    }

    prog.fase = "sincronizando";
    broadcast();

    // Fila com concorrência
    let idx = 0;
    let sessaoMeliCaida = false;
    let sessaoJmroutesCaida = false;

    async function worker() {
      while (!isCancelled()) {
        const myIdx = idx++;
        if (myIdx >= ativos.length) return;
        const routeId = ativos[myIdx];
        prog.atual = Math.min(myIdx + 1, ativos.length);
        prog.routeAtual = routeId;
        broadcast();

        // Detalhe
        const detalhe = await runInMeliTab(state.meliTabId, fetchRouteDetailInPage, [routeId]);
        if (isCancelled()) return;
        if (!detalhe || !detalhe.ok) {
          prog.erros += 1;
          prog.processadas += 1;
          const motivo = detalhe?.reason === "sessao_expirada" ? "sessão Meli expirada"
            : detalhe?.reason === "not_found" ? "HTTP 404"
            : detalhe?.reason === "timeout" ? "timeout"
            : detalhe?.reason === "content_type" ? "HTML no lugar do JSON"
            : detalhe?.reason || "erro";
          prog.problemas.push({ routeId, motivo });
          if (detalhe?.reason === "sessao_expirada") sessaoMeliCaida = true;
          broadcast();
          if (sessaoMeliCaida) return;
          await sleep(ITEM_SPACING_MS);
          continue;
        }

        // Envia
        const env = await enviarJmroutes(detalhe.payload, token, abortController.signal);
        if (isCancelled()) return;
        prog.processadas += 1;

        if (!env.body) {
          prog.erros += 1;
          prog.problemas.push({ routeId, motivo: "sem resposta do JMRoutes" });
        } else if (env.status === 401 || env.body.codigo === "nao_autenticado") {
          sessaoJmroutesCaida = true;
          prog.erros += 1;
          prog.problemas.push({ routeId, motivo: "sessão JMRoutes expirada" });
          broadcast();
          return;
        } else if (env.body.requer_confirmacao) {
          prog.divergencias += 1;
          prog.problemas.push({ routeId, motivo: "divergência" });
        } else if (env.body.ok) {
          prog.sucesso += 1;
          prog.pacotes_inseridos += Number(env.body.inseridos || 0);
          prog.pacotes_atualizados += Number(env.body.atualizados || 0);
          prog.pacotes_inalterados += Number(env.body.inalterados || 0);
          prog.pacotes_invalidos += Number(env.body.invalidos || 0);
        } else {
          prog.erros += 1;
          prog.problemas.push({ routeId, motivo: env.body.mensagem || env.body.codigo || "erro" });
        }
        broadcast();
        await sleep(ITEM_SPACING_MS);
      }
    }

    const workers = [];
    const conc = state.concurrency;
    for (let i = 0; i < conc; i += 1) workers.push(worker());
    await Promise.all(workers);

    if (isCancelled()) { prog.fase = "cancelado"; broadcast(); return { ok: false }; }

    // Backoff automático se muitos erros
    if (prog.total > 0 && prog.erros / prog.total > 0.3) {
      state.continuous = false;
      await saveConfig();
      prog.mensagem = "Sincronização contínua pausada: mais de 30% das rotas falharam.";
    }
    if (sessaoMeliCaida) {
      state.continuous = false;
      await saveConfig();
      prog.mensagem = "Sua sessão do Mercado Livre expirou. Faça login novamente.";
    }
    if (sessaoJmroutesCaida) {
      state.continuous = false;
      await saveConfig();
      prog.mensagem = "Faça login no JMRoutes e tente novamente.";
    }

    prog.duracaoMs = Date.now() - t0;
    prog.ultimaSync = Date.now();
    await saveConfig();
    prog.fase = state.continuous ? "aguardando" : "parado";
    prog.proximaEm = state.continuous ? Date.now() + CYCLE_INTERVAL_MS : null;
    broadcast();
    return { ok: true };
  } catch (e) {
    prog.fase = "pausado";
    prog.mensagem = "Erro inesperado: " + (e && e.message ? e.message : "desconhecido");
    broadcast();
    return { ok: false };
  } finally {
    state.running = false;
    // reagenda alarme se contínuo
    if (state.continuous) {
      chrome.alarms.create("jm-sync-cycle", { delayInMinutes: CYCLE_INTERVAL_MS / 60000 });
    }
  }
}

function cancelarCiclo() {
  state.cancelToken += 1;
  state.running = false;
  state.progress.fase = "cancelado";
  state.progress.mensagem = "Cancelado pelo usuário.";
  broadcast();
}

// ============================================================
// Alarms para modo contínuo
// ============================================================
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "jm-sync-cycle") return;
  if (!state.continuous) return;
  if (state.running) return;
  executarCiclo({ manual: false });
});

async function ativarContinuo() {
  state.continuous = true;
  await saveConfig();
  if (!state.running) executarCiclo({ manual: false });
}
async function desativarContinuo() {
  state.continuous = false;
  await saveConfig();
  chrome.alarms.clear("jm-sync-cycle").catch(() => {});
  if (state.progress.fase === "aguardando") {
    state.progress.fase = "parado";
    state.progress.proximaEm = null;
    broadcast();
  }
}

// ============================================================
// Mensageria
// ============================================================
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return false;
  (async () => {
    switch (message.type) {
      case "jm/getState":
        sendResponse({ state: snapshot() });
        break;
      case "jm/syncOnce":
        if (!state.running) executarCiclo({ manual: true });
        sendResponse({ ok: true });
        break;
      case "jm/cancel":
        cancelarCiclo();
        sendResponse({ ok: true });
        break;
      case "jm/setContinuous":
        if (message.value) await ativarContinuo();
        else await desativarContinuo();
        sendResponse({ ok: true, state: snapshot() });
        break;
      case "jm/setConcurrency":
        if ([2, 4, 6].includes(message.value)) {
          state.concurrency = message.value;
          await saveConfig();
        }
        sendResponse({ ok: true, state: snapshot() });
        break;
      case "captureRouteDetailWithDebugger":
        // fallback do popup para rota única — mantido para compatibilidade.
        {
          const tabId = Number(message.tabId);
          const routeId = String(message.routeId || "");
          const r = await captureRouteWithDebugger(tabId, routeId);
          sendResponse(r);
        }
        break;
      default:
        return;
    }
  })().catch((e) => { try { sendResponse({ ok: false, error: String(e && e.message || e) }); } catch { /* ignore */ } });
  return true;
});

// Bootstrap
loadConfig().then(() => {
  if (state.continuous) {
    chrome.alarms.create("jm-sync-cycle", { delayInMinutes: CYCLE_INTERVAL_MS / 60000 });
  }
});

// ============================================================
// Debugger fallback (mantido — usado pelo popup para rota única)
// ============================================================
function isObject(v) { return v !== null && typeof v === "object"; }
function isRoutePayload(v, routeId) {
  if (!isObject(v) || !Array.isArray(v.stops)) return false;
  const id = v.id ?? v.routeId ?? v.route_id;
  return id === undefined || id === null || String(id) === String(routeId);
}
function findRoutePayload(root, routeId) {
  const seen = new WeakSet();
  const stack = [root];
  let visited = 0;
  while (stack.length && visited < 10000) {
    const cur = stack.pop();
    visited += 1;
    if (!isObject(cur) || seen.has(cur)) continue;
    seen.add(cur);
    if (isRoutePayload(cur, routeId)) return cur;
    if (Array.isArray(cur)) {
      for (let i = Math.min(cur.length - 1, 500); i >= 0; i -= 1) stack.push(cur[i]);
      continue;
    }
    for (const k of Object.keys(cur).slice(0, 350)) if (isObject(cur[k])) stack.push(cur[k]);
  }
  return null;
}
function safeJsonFromBody(body, b64) {
  try {
    const text = b64 ? atob(body) : body;
    if (!text || (!text.trim().startsWith("{") && !text.trim().startsWith("["))) return null;
    return JSON.parse(text);
  } catch { return null; }
}
function requestScore(url, postData, routeId) {
  const j = `${url || ""}\n${postData || ""}`.toLowerCase();
  let s = 0;
  if (j.includes(String(routeId))) s += 100;
  if (j.includes("route-detail") || j.includes("route_detail")) s += 85;
  if (j.includes("monitoring-distribution")) s += 40;
  if (j.includes("route")) s += 25;
  if (/\.(js|css|png|jpg|jpeg|svg|gif|woff|woff2)(\?|$)/i.test(url || "")) s -= 300;
  return s;
}
async function captureRouteWithDebugger(tabId, routeId) {
  const debuggee = { tabId };
  const meta = new Map();
  let settled = false;
  let attached = false;
  let last = null;
  const cleanup = async (l) => {
    chrome.debugger.onEvent.removeListener(l);
    if (attached) { try { await chromeAsync(chrome.debugger.detach, debuggee); } catch { /* ignore */ } }
  };
  return new Promise(async (resolve) => {
    const finish = (r) => { if (settled) return; settled = true; clearTimeout(timer); cleanup(onEvent).finally(() => resolve(r)); };
    const timer = setTimeout(() => finish({ ok: false, reason: "debugger_timeout", lastCandidate: last }), 45000);
    const onEvent = (source, method, params) => {
      if (!source || source.tabId !== tabId || settled) return;
      if (method === "Network.requestWillBeSent") {
        const req = params.request || {};
        const sc = requestScore(req.url, req.postData, routeId);
        if (sc > 35) { meta.set(params.requestId, { url: req.url, score: sc }); last = { url: req.url, score: sc }; }
        return;
      }
      if (method !== "Network.responseReceived") return;
      const resp = params.response || {};
      const m = meta.get(params.requestId);
      const sc = Math.max(m?.score || 0, requestScore(resp.url, "", routeId));
      const mime = String(resp.mimeType || "").toLowerCase();
      if (sc <= 35 || (!mime.includes("json") && !mime.includes("text"))) return;
      last = { url: resp.url, status: resp.status, score: sc };
      chrome.debugger.sendCommand(debuggee, "Network.getResponseBody", { requestId: params.requestId }, (br) => {
        if (settled || chrome.runtime.lastError || !br) return;
        const parsed = safeJsonFromBody(br.body, br.base64Encoded);
        if (!parsed) return;
        const p = isRoutePayload(parsed, routeId) ? parsed : findRoutePayload(parsed, routeId);
        if (p) finish({ ok: true, payload: p, urlUsada: resp.url || m?.url || "debugger" });
      });
    };
    try {
      chrome.debugger.onEvent.addListener(onEvent);
      await chromeAsync(chrome.debugger.attach, debuggee, "1.3");
      attached = true;
      await chromeAsync(chrome.debugger.sendCommand, debuggee, "Network.enable");
      await chromeAsync(chrome.debugger.sendCommand, debuggee, "Network.setCacheDisabled", { cacheDisabled: true });
      await chromeAsync(chrome.tabs.reload, tabId, { bypassCache: true });
    } catch (e) {
      finish({ ok: false, reason: "debugger_unavailable", message: e && e.message ? e.message : "" });
    }
  });
}
