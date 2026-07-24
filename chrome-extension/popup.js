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
    const routeIdText = String(routeId);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);

    function safeUrlForLog(url) {
      try {
        const u = new URL(url, window.location.href);
        ["access_token", "token", "jwt", "authorization"].forEach((k) => {
          if (u.searchParams.has(k)) u.searchParams.set(k, "***");
        });
        return u.href;
      } catch {
        return String(url).slice(0, 180);
      }
    }

    function isObject(v) {
      return v !== null && typeof v === "object";
    }

    function isRoutePayload(v) {
      if (!isObject(v) || !Array.isArray(v.stops)) return false;
      const id = v.id ?? v.routeId ?? v.route_id;
      return id === undefined || id === null || String(id) === routeIdText;
    }

    function clonePayload(v) {
      try {
        return JSON.parse(JSON.stringify(v));
      } catch {
        return null;
      }
    }

    function findRoutePayload(root) {
      const seen = new WeakSet();
      const stack = [root];
      let visited = 0;
      while (stack.length && visited < 8000) {
        const cur = stack.pop();
        visited += 1;
        if (!isObject(cur)) continue;
        if (seen.has(cur)) continue;
        seen.add(cur);
        if (isRoutePayload(cur)) {
          const cloned = clonePayload(cur);
          if (cloned) return cloned;
        }
        if (Array.isArray(cur)) {
          for (let i = Math.min(cur.length - 1, 300); i >= 0; i -= 1) stack.push(cur[i]);
          continue;
        }
        for (const key of Object.keys(cur).slice(0, 250)) {
          try {
            const value = cur[key];
            if (isObject(value)) stack.push(value);
          } catch {
            // ignora getters protegidos da página.
          }
        }
      }
      return null;
    }

    function payloadJaCarregadoNaPagina() {
      const nomesGlobais = [
        "__PRELOADED_STATE__",
        "__INITIAL_STATE__",
        "__NEXT_DATA__",
        "__APOLLO_STATE__",
        "__REDUX_STATE__",
        "__MELI_STATE__",
        "__MELI_CONTEXT__",
        "__ROUTE_DETAIL__",
      ];
      for (const nome of nomesGlobais) {
        try {
          const payload = findRoutePayload(window[nome]);
          if (payload) return { payload, fonte: nome };
        } catch {
          // continua procurando.
        }
      }

      try {
        const scripts = Array.from(document.querySelectorAll('script[type="application/json"], script:not([src])'));
        for (const script of scripts) {
          const text = script.textContent || "";
          if (!text.includes(routeIdText) || !text.includes("stops")) continue;
          try {
            const parsed = JSON.parse(text);
            const payload = findRoutePayload(parsed);
            if (payload) return { payload, fonte: "script-json" };
          } catch {
            // scripts inline nem sempre são JSON puro.
          }
        }
      } catch {
        // ignora leitura de scripts.
      }

      for (const storage of [window.sessionStorage, window.localStorage]) {
        try {
          for (let i = 0; i < storage.length && i < 80; i += 1) {
            const key = storage.key(i);
            if (!key) continue;
            const text = storage.getItem(key) || "";
            if (!text.includes(routeIdText) || !text.includes("stops")) continue;
            try {
              const parsed = JSON.parse(text);
              const payload = findRoutePayload(parsed);
              if (payload) return { payload, fonte: "storage:" + key };
            } catch {
              // continua.
            }
          }
        } catch {
          // storage pode estar bloqueado.
        }
      }
      return null;
    }

    function hasRouteIdentifier(u) {
      if (u.pathname.includes(routeIdText)) return true;
      for (const [key, value] of u.searchParams.entries()) {
        if (/route|id|route_id|routeId/i.test(key) && String(value) === routeIdText) return true;
      }
      return false;
    }

    function normalizeCandidateUrl(raw) {
      try {
        const current = new URL(window.location.href);
        const u = new URL(raw, window.location.href);
        const looksLikeRouteDetail = /route[-_]?detail|monitoring-distribution|detail/i.test(u.href);
        if (looksLikeRouteDetail && !hasRouteIdentifier(u)) {
          u.searchParams.set("routeId", routeIdText);
        }
        const site = current.searchParams.get("site");
        if (site && !u.searchParams.has("site")) u.searchParams.set("site", site);
        return u.href;
      } catch {
        return null;
      }
    }

    function scoreEntry(entry) {
      const name = String(entry.name || "").toLowerCase();
      let score = 0;
      if (name.includes(routeIdText)) score += 80;
      if (name.includes("route-detail") || name.includes("route_detail")) score += 70;
      if (name.includes("monitoring-distribution")) score += 35;
      if (name.includes("/api/") || name.includes("api.")) score += 20;
      if (name.includes("detail")) score += 15;
      if (name.includes("route")) score += 10;
      if (entry.initiatorType === "fetch" || entry.initiatorType === "xmlhttprequest") score += 25;
      if (/\.(js|css|png|jpg|jpeg|svg|gif|woff|woff2)(\?|$)/i.test(name)) score -= 200;
      return score;
    }

    (async () => {
      const cached = payloadJaCarregadoNaPagina();
      if (cached && cached.payload) {
        clearTimeout(timer);
        resolve({ ok: true, payload: cached.payload, urlUsada: cached.fonte });
        return;
      }

      const routeDetailUrl =
        "https://envios.adminml.com/logistics/api/monitoring-route/route-detail?routeId=" +
        encodeURIComponent(routeIdText) +
        "&siteId=MLB";

      const tentativas = [];
      try {
        const r = await fetch(routeDetailUrl, {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json, text/plain, */*" },
          signal: ctrl.signal,
        });
        const ct = (r.headers.get("content-type") || "").toLowerCase();
        const urlLog = safeUrlForLog(routeDetailUrl);
        tentativas.push({ url: urlLog, status: r.status, contentType: ct.slice(0, 80) });

        if (!r.ok) {
          clearTimeout(timer);
          const reason = r.status === 401 || r.status === 403 ? "sessao_expirada"
            : r.status === 404 ? "not_found"
            : "http";
          resolve({ ok: false, status: r.status, reason, tentativas });
          return;
        }
        if (!ct.includes("json")) {
          clearTimeout(timer);
          resolve({ ok: false, status: r.status, reason: "content_type", tentativas });
          return;
        }
        const parsed = await r.json();
        if (!isObject(parsed) || !Array.isArray(parsed.stops) || String(parsed.id ?? "") !== routeIdText) {
          clearTimeout(timer);
          resolve({ ok: false, status: r.status, reason: "payload_shape", tentativas });
          return;
        }
        clearTimeout(timer);
        resolve({ ok: true, payload: parsed, urlUsada: urlLog });
      } catch (e) {
        clearTimeout(timer);
        if (e && e.name === "AbortError") {
          resolve({ ok: false, reason: "timeout", tentativas });
          return;
        }
        resolve({ ok: false, reason: "network", tentativas });
      }
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

async function captureFromMeliNetwork() {
  if (!detectedRouteId || !activeTabId) return null;
  try {
    return await chrome.runtime.sendMessage({
      type: "captureRouteDetailWithDebugger",
      tabId: activeTabId,
      routeId: detectedRouteId,
    });
  } catch (e) {
    return {
      ok: false,
      reason: "debugger_error",
      message: e && e.message ? e.message : "Falha na captura de rede.",
    };
  }
}

function renderCaptureDiagnostics(capt) {
  const tentativas = Array.isArray(capt.tentativas) ? capt.tentativas.slice(-6) : [];
  if (tentativas.length === 0) return;
  const linhas = tentativas.map((t, i) => {
    const status = t.status ?? "—";
    const url = String(t.url || "").replace(/^https:\/\/envios\.adminml\.com/, "");
    return `${i + 1}. ${status} — ${url}`;
  });
  showResult(["Diagnóstico da captura:", ...linhas].join("\n"));
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
      let capt = await captureFromMeli();
      if (!capt.ok) {
        setStatusLoading("Localizando request real do Meli…");
        const rede = await captureFromMeliNetwork();
        if (rede && rede.ok) capt = rede;
        else if (rede && Array.isArray(rede.tentativas)) capt.tentativas = rede.tentativas;
        else if (rede && rede.lastCandidate) {
          capt.tentativas = [{ url: rede.lastCandidate.url, status: rede.lastCandidate.status || "capturado", contentType: "debugger" }];
        }
      }
      if (!capt.ok) {
        if (capt.status === 401 || capt.status === 403) {
          setStatus("Faça login no Mercado Livre e tente novamente.", "error");
        } else if (capt.status === 404) {
          setStatus("Endpoint da rota não encontrado no Meli.", "error");
        } else if (capt.reason === "timeout") {
          setStatus("Tempo esgotado ao consultar o Meli.", "error");
        } else if (capt.reason === "network") {
          setStatus("Não foi possível conectar ao Meli.", "error");
        } else if (capt.reason === "payload_shape") {
          setStatus("O Meli respondeu, mas em formato diferente do esperado.", "error");
        } else if (capt.reason === "not_found") {
          setStatus("Endpoint da rota não encontrado no Meli.", "error");
        } else if (capt.reason === "debugger_unavailable") {
          setStatus("Chrome não permitiu capturar a rede da aba do Meli.", "error");
        } else if (capt.reason === "debugger_timeout") {
          setStatus("Não encontrei o JSON da rota durante o recarregamento.", "error");
        } else {
          setStatus("Não foi possível capturar a rota. Tente novamente.", "error");
        }
        renderCaptureDiagnostics(capt);
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
