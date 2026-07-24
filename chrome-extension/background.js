// Service worker da extensão JM Routes Importador.
// Não armazena payload, tokens, cookies ou dados pessoais. O uso do debugger
// é pontual: apenas quando a captura direta falha, para observar o request real
// de rota feito pela própria página do Meli durante um reload.
self.addEventListener("install", () => {
  self.skipWaiting?.();
});
self.addEventListener("activate", () => {
  self.clients?.claim?.();
});

function chromeAsync(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result);
    });
  });
}

function isObject(v) {
  return v !== null && typeof v === "object";
}

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
    if (!isObject(cur)) continue;
    if (seen.has(cur)) continue;
    seen.add(cur);
    if (isRoutePayload(cur, routeId)) return cur;
    if (Array.isArray(cur)) {
      for (let i = Math.min(cur.length - 1, 500); i >= 0; i -= 1) stack.push(cur[i]);
      continue;
    }
    for (const key of Object.keys(cur).slice(0, 350)) {
      const value = cur[key];
      if (isObject(value)) stack.push(value);
    }
  }
  return null;
}

function safeJsonFromBody(body, base64Encoded) {
  try {
    const text = base64Encoded ? atob(body) : body;
    if (!text || (!text.trim().startsWith("{") && !text.trim().startsWith("["))) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function requestScore(url, postData, routeId) {
  const joined = `${url || ""}\n${postData || ""}`.toLowerCase();
  let score = 0;
  if (joined.includes(String(routeId))) score += 100;
  if (joined.includes("route-detail") || joined.includes("route_detail")) score += 85;
  if (joined.includes("monitoring-distribution")) score += 40;
  if (joined.includes("route")) score += 25;
  if (joined.includes("detail")) score += 15;
  if (joined.includes("graphql")) score += 15;
  if (joined.includes("api")) score += 10;
  if (/\.(js|css|png|jpg|jpeg|svg|gif|woff|woff2)(\?|$)/i.test(url || "")) score -= 300;
  return score;
}

async function captureRouteWithDebugger(tabId, routeId) {
  const debuggee = { tabId };
  const requestMeta = new Map();
  let settled = false;
  let attached = false;
  let lastCandidate = null;

  const cleanup = async (listener) => {
    chrome.debugger.onEvent.removeListener(listener);
    if (attached) {
      try {
        await chromeAsync(chrome.debugger.detach, debuggee);
      } catch {
        // já pode estar desanexado.
      }
    }
  };

  return new Promise(async (resolve) => {
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup(onEvent).finally(() => resolve(result));
    };

    const timer = setTimeout(() => {
      finish({ ok: false, reason: "debugger_timeout", lastCandidate });
    }, 45000);

    const onEvent = (source, method, params) => {
      if (!source || source.tabId !== tabId || settled) return;

      if (method === "Network.requestWillBeSent") {
        const request = params.request || {};
        const score = requestScore(request.url, request.postData, routeId);
        if (score > 35) {
          requestMeta.set(params.requestId, { url: request.url, score });
          lastCandidate = { url: request.url, score };
        }
        return;
      }

      if (method !== "Network.responseReceived") return;
      const response = params.response || {};
      const meta = requestMeta.get(params.requestId);
      const score = Math.max(meta?.score || 0, requestScore(response.url, "", routeId));
      const mime = String(response.mimeType || "").toLowerCase();
      if (score <= 35 || (!mime.includes("json") && !mime.includes("text"))) return;
      lastCandidate = { url: response.url, status: response.status, score };

      chrome.debugger.sendCommand(debuggee, "Network.getResponseBody", { requestId: params.requestId }, (bodyResult) => {
        if (settled) return;
        if (chrome.runtime.lastError || !bodyResult) return;
        const parsed = safeJsonFromBody(bodyResult.body, bodyResult.base64Encoded);
        if (!parsed) return;
        const payload = isRoutePayload(parsed, routeId) ? parsed : findRoutePayload(parsed, routeId);
        if (payload) {
          finish({ ok: true, payload, urlUsada: response.url || meta?.url || "debugger" });
        }
      });
    };

    try {
      chrome.debugger.onEvent.addListener(onEvent);
      await chromeAsync(chrome.debugger.attach, debuggee, "1.3");
      attached = true;
      await chromeAsync(chrome.debugger.sendCommand, debuggee, "Network.enable");
      await chromeAsync(chrome.debugger.sendCommand, debuggee, "Network.setCacheDisabled", { cacheDisabled: true });
      await chromeAsync(chrome.tabs.reload, tabId, { bypassCache: true });
    } catch (err) {
      finish({ ok: false, reason: "debugger_unavailable", message: err && err.message ? err.message : "debugger indisponível" });
    }
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "captureRouteDetailWithDebugger") return false;
  const tabId = Number(message.tabId);
  const routeId = String(message.routeId || "");
  if (!Number.isFinite(tabId) || !routeId) {
    sendResponse({ ok: false, reason: "invalid_request" });
    return false;
  }
  captureRouteWithDebugger(tabId, routeId)
    .then((result) => sendResponse(result))
    .catch((err) => sendResponse({ ok: false, reason: "debugger_error", message: err && err.message ? err.message : "erro" }));
  return true;
});
