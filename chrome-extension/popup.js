// JM Routes Importador — popup logic.
// - Detecta o routeId da aba ativa do Meli.
// - Captura o JSON de route-detail no contexto da aba do Meli via chrome.scripting.
// - Envia ao endpoint público do JMRoutes com Bearer token da sessão Supabase.
// - Não persiste payload, token, cookies ou dados pessoais.

const JMROUTES_ORIGIN = "https://jmroutes.app";
const IMPORT_ENDPOINT = JMROUTES_ORIGIN + "/api/public/meli/importar-rota-bruta";
const SUPABASE_PROJECT_REF = "ieqvzndvkzozqvseubuc";
const STORAGE_KEY = "sb-" + SUPABASE_PROJECT_REF + "-auth-token";

const MELI_DETAIL_PATH = /^\/logistics\/monitoring-distribution\/detail\/(\d+)\/?$/;
const MELI_HOST = "envios.adminml.com";

const $ = (id) => document.getElementById(id);
const els = {
  routeId: $("routeId"),
  status: $("status"),
  btnImportar: $("btnImportar"),
  btnConfirmar: $("btnConfirmar"),
  divergencia: $("divergencia"),
  divMeli: $("divMeli"),
  divExtr: $("divExtr"),
  divDif: $("divDif"),
  result: $("result"),
};

// Estado em memória somente (nunca em storage).
let detectedRouteId = null;
let activeTabId = null;
let capturedPayload = null;

function setStatus(text, kind) {
  els.status.className = "status status-" + (kind || "idle");
  els.status.textContent = text;
}
function setStatusLoading(text) {
  els.status.className = "status status-info";
  els.status.innerHTML = '<span class="spinner"></span>' + escapeHtml(text);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function showResult(text) {
  els.result.textContent = text;
  els.result.classList.remove("hidden");
}
function hideDiv() { els.divergencia.classList.add("hidden"); els.btnConfirmar.classList.add("hidden"); }
function reset() { els.result.classList.add("hidden"); hideDiv(); }

async function detectRoute() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) {
    setStatus("Abra os detalhes de uma rota no Mercado Livre.", "warn");
    return;
  }
  activeTabId = tab.id;
  let u;
  try { u = new URL(tab.url); } catch { u = null; }
  if (!u || u.hostname !== MELI_HOST) {
    els.routeId.textContent = "—";
    setStatus("Abra os detalhes de uma rota no Mercado Livre.", "warn");
    return;
  }
  const m = u.pathname.match(MELI_DETAIL_PATH);
  if (!m) {
    els.routeId.textContent = "—";
    setStatus("Abra os detalhes de uma rota válida no Mercado Livre.", "warn");
    return;
  }
  detectedRouteId = m[1];
  els.routeId.textContent = detectedRouteId;
  els.btnImportar.disabled = false;
  setStatus("Pronto para importar.", "idle");
}

// Executado NO contexto da aba do Meli (sem acesso ao escopo do popup).
function fetchRouteDetailInPage(routeId) {
  return new Promise((resolve) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);

    // Descobre a URL real do route-detail já usada pela página do Meli,
    // em vez de adivinhar o caminho. O Meli varia entre /logistics/...,
    // /logistics/api/... e /api/..., e o path pode mudar sem aviso.
    function descobrirUrl() {
      try {
        const entries = performance.getEntriesByType("resource") || [];
        const comRouteDetail = entries
          .map((e) => e.name)
          .filter((n) => typeof n === "string" && n.indexOf("route-detail") !== -1);
        const comRouteId = comRouteDetail.filter((n) => n.indexOf(String(routeId)) !== -1);
        const escolhida = comRouteId[comRouteId.length - 1] || comRouteDetail[comRouteDetail.length - 1] || null;
        if (!escolhida) return null;
        const u = new URL(escolhida, window.location.origin);
        u.searchParams.set("routeId", String(routeId));
        return u.pathname + "?" + u.searchParams.toString();
      } catch {
        return null;
      }
    }

    const candidatas = [];
    const descoberta = descobrirUrl();
    if (descoberta) candidatas.push(descoberta);
    // Fallbacks conhecidos (compatibilidade).
    candidatas.push(
      "/logistics/monitoring-distribution/route-detail?routeId=" + encodeURIComponent(routeId),
      "/logistics/api/monitoring-distribution/route-detail?routeId=" + encodeURIComponent(routeId),
      "/api/monitoring-distribution/route-detail?routeId=" + encodeURIComponent(routeId),
    );
    const urls = Array.from(new Set(candidatas));

    (async () => {
      let ultimoStatus = null;
      let ultimoMotivo = null;
      for (const url of urls) {
        try {
          const r = await fetch(url, {
            method: "GET",
            credentials: "include",
            headers: { Accept: "application/json" },
            signal: ctrl.signal,
          });
          const ct = (r.headers.get("content-type") || "").toLowerCase();
          const text = await r.text();
          if (!r.ok) {
            ultimoStatus = r.status;
            ultimoMotivo = null;
            continue;
          }
          if (!ct.includes("json")) {
            ultimoStatus = r.status;
            ultimoMotivo = "content_type";
            continue;
          }
          try {
            const parsed = JSON.parse(text);
            clearTimeout(timer);
            resolve({ ok: true, payload: parsed, urlUsada: url });
            return;
          } catch {
            ultimoStatus = r.status;
            ultimoMotivo = "parse";
            continue;
          }
        } catch (e) {
          if (e && e.name === "AbortError") {
            clearTimeout(timer);
            resolve({ ok: false, reason: "timeout" });
            return;
          }
          ultimoMotivo = "network";
        }
      }
      clearTimeout(timer);
      resolve({ ok: false, status: ultimoStatus, reason: ultimoMotivo, tentativas: urls });
    })();
  });
}

async function captureFromMeli() {
  if (!detectedRouteId || !activeTabId) return null;
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    world: "MAIN",
    func: fetchRouteDetailInPage,
    args: [detectedRouteId],
  });
  return res && res.result ? res.result : { ok: false, reason: "script" };
}

// Lê a sessão Supabase em uma aba jmroutes.app (via chrome.scripting).
async function getJmroutesAccessToken() {
  // Localiza abas jmroutes.app.
  const tabs = await chrome.tabs.query({ url: [JMROUTES_ORIGIN + "/*", "https://www.jmroutes.app/*"] });
  let tab = tabs[0];
  if (!tab) {
    // Abre uma nova aba e aguarda carregar antes de solicitar login.
    tab = await chrome.tabs.create({ url: JMROUTES_ORIGIN + "/", active: false });
    await new Promise((r) => setTimeout(r, 1500));
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
      args: [STORAGE_KEY],
    });
    return res && res.result ? res.result : null;
  } catch {
    return null;
  }
}

async function sendToJmroutes(payload, confirmar) {
  const token = await getJmroutesAccessToken();
  if (!token) {
    return { httpOk: false, body: { ok: false, codigo: "nao_autenticado", mensagem: "Faça login no JMRoutes e tente novamente." } };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const r = await fetch(IMPORT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ payload, confirmar_divergencia: !!confirmar }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    let body = null;
    try { body = await r.json(); } catch { body = null; }
    return { httpOk: r.ok, status: r.status, body };
  } catch (e) {
    clearTimeout(timer);
    return { httpOk: false, body: { ok: false, codigo: e && e.name === "AbortError" ? "timeout" : "rede", mensagem: e && e.name === "AbortError" ? "Tempo esgotado. Tente novamente." : "Não foi possível conectar ao servidor. Verifique sua internet." } };
  }
}

function renderResultado(body) {
  const linhas = [
    "Rota importada com sucesso",
    "Rota: " + (body.route_id ?? detectedRouteId ?? "—"),
    "Inseridos: " + (body.inseridos ?? 0),
    "Atualizados: " + (body.atualizados ?? 0),
    "Inalterados: " + (body.inalterados ?? 0),
    "Inválidos: " + (body.invalidos ?? 0),
  ];
  showResult(linhas.join("\n"));
  setStatus("Importação concluída.", "success");
}

function renderDivergencia(body) {
  els.divMeli.textContent = body.total_meli ?? "—";
  els.divExtr.textContent = body.total_extraido ?? "—";
  els.divDif.textContent = body.diferenca ?? "—";
  els.divergencia.classList.remove("hidden");
  els.btnConfirmar.classList.remove("hidden");
  setStatus("Aguardando confirmação de divergência.", "warn");
}

async function importar(confirmar) {
  reset();
  els.btnImportar.disabled = true;
  els.btnConfirmar.disabled = true;

  try {
    let payload = capturedPayload;
    if (!payload) {
      setStatusLoading("Capturando dados do Meli…");
      const capt = await captureFromMeli();
      if (!capt.ok) {
        if (capt.status === 401 || capt.status === 403) {
          setStatus("Faça login no Mercado Livre e tente novamente.", "error");
        } else if (capt.status === 404) {
          setStatus("Rota não encontrada no Meli.", "error");
        } else if (capt.reason === "timeout") {
          setStatus("Tempo esgotado ao consultar o Meli.", "error");
        } else if (capt.reason === "network") {
          setStatus("Não foi possível conectar ao Meli.", "error");
        } else {
          setStatus("Não foi possível capturar a rota. Tente novamente.", "error");
        }
        return;
      }
      payload = capt.payload;
      if (!payload || payload.id === undefined || !Array.isArray(payload.stops)) {
        setStatus("Payload do Meli inválido.", "error");
        return;
      }
      capturedPayload = payload;
    }

    setStatusLoading("Enviando ao JMRoutes…");
    const { httpOk, status, body } = await sendToJmroutes(payload, confirmar);

    if (!body) {
      setStatus("Não foi possível importar a rota. Tente novamente.", "error");
      return;
    }
    if (body.requer_confirmacao) {
      renderDivergencia(body);
      return;
    }
    if (body.ok) {
      renderResultado(body);
      // limpa payload após sucesso.
      capturedPayload = null;
      return;
    }
    if (status === 401 || body.codigo === "nao_autenticado") {
      setStatus(body.mensagem || "Faça login no JMRoutes e tente novamente.", "error");
      return;
    }
    if (status === 403 || body.codigo === "sem_permissao") {
      setStatus(body.mensagem || "Seu perfil não possui permissão para importar rotas.", "error");
      return;
    }
    setStatus(body.mensagem || "Não foi possível importar a rota.", "error");
    void httpOk;
  } finally {
    els.btnImportar.disabled = !detectedRouteId;
    els.btnConfirmar.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  detectRoute();
  els.btnImportar.addEventListener("click", () => importar(false));
  els.btnConfirmar.addEventListener("click", () => importar(true));
});

// Garantia extra: não persistir payload ao fechar.
window.addEventListener("unload", () => { capturedPayload = null; });
