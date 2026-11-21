// El script de la tienda «La Bodega de Chapinero» (punto 116 del architecture-log.md). No conoce
// ninguna pasarela: lo único de pagos que usa es `tokenizeCard()`, que pone el módulo de pagos
// en /payments/client.js.

const CART_KEY = "kit-pagos-prototipo-b:cart";
const MAX_QUANTITY = 9;
const POLL_INTERVAL_MS = 2500;
const POLL_ATTEMPTS = 8;

const message = document.getElementById("message");

function show(text) {
  if (message) message.textContent = text;
}

// La traza del navegador, en la consola (F12) con [tienda B]: cada llamada de la página a la tienda
// y la tokenización, que sale del navegador directo a la pasarela. Nunca registra el cuerpo de la
// petición, que lleva la tarjeta, ni una llave completa.
const KEY_PATTERNS = [
  [/\b(pub|prv)_(test|prod|stagtest)_[A-Za-z0-9]+/g, "$1_$2_…"],
  [/\b(APP_USR|TEST)-[A-Za-z0-9-]+/g, "$1-…"],
];

function traceLine(...parts) {
  console.info("[tienda B]", ...parts);
}

const MONITOR_LOGS_KEY = "kit-pagos-prototipo-b:monitor-logs";
const MONITOR_STAGES_KEY = "kit-pagos-prototipo-b:monitor-stages";
const MONITOR_OPEN_KEY = "kit-pagos-prototipo-b:monitor-open";
const MONITOR_PAUSE_KEY = "kit-pagos-prototipo-b:monitor-pause";
const MONITOR_MAX_LOGS = 40;
const STAGE_DEFAULTS = {
  front: "En espera",
  browser: "Tokenización",
  backend: "KitPagos",
  sandbox: "HTTP externo",
  response: "Normalizada",
};
const TAG_BY_STAGE = {
  front: "FRONT",
  browser: "SDK-BROWSER→PASARELA",
  backend: "SDK-BACK",
  sandbox: "PASARELA",
  response: "RESPUESTA",
  error: "ERROR",
};

function readSessionJson(key, fallback) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeSessionJson(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignora restricciones del navegador (p. ej. modo incógnito estricto).
  }
}

function formatLogTime(iso) {
  const date = iso ? new Date(iso) : new Date();
  return Number.isNaN(date.getTime()) ? "--:--:--" : date.toTimeString().slice(0, 8);
}

function createMonitor() {
  const root = document.getElementById("sdk-monitor");
  const body = document.getElementById("sdk-monitor-body");
  const toggleBtn = document.getElementById("monitor-toggle");
  const collapseBtn = document.getElementById("monitor-collapse");
  const clearBtn = document.getElementById("monitor-clear");
  const pauseInput = document.getElementById("monitor-pause");
  const continueBar = document.getElementById("monitor-continue-bar");
  const continueText = document.getElementById("monitor-continue-text");
  const continueBtn = document.getElementById("monitor-continue-btn");
  const logList = document.getElementById("monitor-log");
  const emptyHint = document.getElementById("monitor-empty");

  let logs = readSessionJson(MONITOR_LOGS_KEY, []);
  if (!Array.isArray(logs)) logs = [];
  let stages = readSessionJson(MONITOR_STAGES_KEY, {});
  if (!stages || typeof stages !== "object") stages = {};
  let isOpen = readSessionJson(MONITOR_OPEN_KEY, false) === true;
  let paused = readSessionJson(MONITOR_PAUSE_KEY, false) === true;
  let pendingContinue;

  function renderOpenState() {
    if (!root || !body) return;
    root.dataset.collapsed = isOpen ? "false" : "true";
    body.hidden = !isOpen;
    if (toggleBtn) toggleBtn.setAttribute("aria-expanded", String(isOpen));
    if (collapseBtn) {
      collapseBtn.setAttribute("aria-expanded", String(isOpen));
      collapseBtn.textContent = isOpen ? "Minimizar" : "Expandir";
    }
  }

  function renderStages() {
    if (!root) return;
    for (const stageEl of root.querySelectorAll(".sdk-stage")) {
      const id = stageEl.dataset.stage;
      const saved = stages[id] || { state: "idle", text: STAGE_DEFAULTS[id] || "" };
      stageEl.dataset.state = saved.state;
      const statusEl = stageEl.querySelector(".sdk-stage__status");
      if (statusEl) statusEl.textContent = saved.text;
    }
  }

  function buildLogItem(entry) {
    const item = document.createElement("li");
    item.className = "sdk-log__item";

    const time = document.createElement("span");
    time.className = "sdk-log__time";
    time.textContent = formatLogTime(entry.at);

    const tag = document.createElement("span");
    const tagStyle = entry.level === "error" ? "error" : entry.stage || "front";
    tag.className = `sdk-log__tag sdk-log__tag--${tagStyle}`;
    tag.textContent = `[${entry.tag || TAG_BY_STAGE[entry.stage] || "SDK"}]`;

    const label = document.createElement("span");
    label.className = "sdk-log__label";
    label.textContent = entry.label || "";

    const detail = document.createElement("span");
    detail.className = "sdk-log__detail";
    detail.textContent = entry.detail ? `· ${entry.detail}` : "";

    item.append(time, tag, label, detail);

    if (typeof entry.durationMs === "number") {
      const ms = document.createElement("span");
      ms.className = "sdk-log__ms";
      ms.textContent = `${Math.round(entry.durationMs)} ms`;
      item.append(ms);
    }
    return item;
  }

  function renderLogs() {
    if (!logList) return;
    if (emptyHint) emptyHint.hidden = logs.length > 0;
    logList.replaceChildren(...logs.map(buildLogItem));
    logList.scrollTop = logList.scrollHeight;
  }

  function open() {
    isOpen = true;
    writeSessionJson(MONITOR_OPEN_KEY, true);
    renderOpenState();
  }

  function setExpanded(next) {
    isOpen = Boolean(next);
    writeSessionJson(MONITOR_OPEN_KEY, isOpen);
    renderOpenState();
  }

  function setStage(stage, state, text) {
    stages[stage] = { state, text: text ?? STAGE_DEFAULTS[stage] ?? "" };
    writeSessionJson(MONITOR_STAGES_KEY, stages);
    renderStages();
  }

  function resetStages() {
    stages = {};
    writeSessionJson(MONITOR_STAGES_KEY, stages);
    renderStages();
  }

  function log(entry) {
    logs.push({
      at: entry.at || new Date().toISOString(),
      stage: entry.stage || "front",
      level: entry.level || "info",
      tag: entry.tag,
      label: entry.label,
      detail: entry.detail,
      durationMs: entry.durationMs,
    });
    if (logs.length > MONITOR_MAX_LOGS) {
      logs = logs.slice(-MONITOR_MAX_LOGS);
    }
    writeSessionJson(MONITOR_LOGS_KEY, logs);
    renderLogs();
  }

  function appendBackendTrace(steps) {
    if (!Array.isArray(steps) || steps.length === 0) return;
    let sawSandbox = false;
    for (const step of steps) {
      if (step.stage === "sandbox") sawSandbox = true;
      log({
        at: step.at,
        stage: step.stage,
        level: step.level,
        label: step.label,
        detail: step.detail,
        durationMs: step.durationMs,
      });
      const stageState = step.level === "info" ? "ok" : step.level;
      const shortStatus =
        step.stage === "sandbox" || step.stage === "response"
          ? step.detail
          : step.label;
      setStage(step.stage, stageState, shortStatus);
    }
    if (!sawSandbox && (!stages.sandbox || stages.sandbox.state === "active")) {
      setStage("sandbox", "idle", "Sin llamada externa");
    }
  }

  function clear() {
    logs = [];
    stages = {};
    writeSessionJson(MONITOR_LOGS_KEY, logs);
    writeSessionJson(MONITOR_STAGES_KEY, stages);
    if (pendingContinue) {
      const resolve = pendingContinue;
      pendingContinue = undefined;
      if (continueBar) continueBar.hidden = true;
      resolve();
    }
    renderStages();
    renderLogs();
  }

  function waitForContinue(label) {
    if (!continueBar || !continueBtn) return Promise.resolve();
    open();
    if (continueText) continueText.textContent = label || "Paso completado. Listo para continuar.";
    continueBar.hidden = false;
    return new Promise((resolve) => {
      pendingContinue = resolve;
      continueBtn.onclick = () => {
        continueBar.hidden = true;
        pendingContinue = undefined;
        resolve();
      };
    });
  }

  if (pauseInput) {
    pauseInput.checked = paused;
    pauseInput.addEventListener("change", () => {
      paused = pauseInput.checked;
      writeSessionJson(MONITOR_PAUSE_KEY, paused);
      if (!paused && pendingContinue) {
        if (continueBar) continueBar.hidden = true;
        const resolve = pendingContinue;
        pendingContinue = undefined;
        resolve();
      }
    });
  }
  toggleBtn?.addEventListener("click", () => setExpanded(!isOpen));
  collapseBtn?.addEventListener("click", () => setExpanded(!isOpen));
  clearBtn?.addEventListener("click", clear);

  renderOpenState();
  renderStages();
  renderLogs();

  return {
    open,
    setStage,
    resetStages,
    log,
    appendBackendTrace,
    shouldPause: () => paused,
    waitForContinue,
  };
}

const monitor = createMonitor();

/** El sentido de la llamada y su ruta, sin la query y con las llaves tapadas. */
function describeCall(method, url) {
  const parsed = new URL(url, window.location.href);
  const sameOrigin = parsed.origin === window.location.origin;
  const shown = sameOrigin ? parsed.pathname : `${parsed.host}${parsed.pathname}`;
  const masked = KEY_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), shown);
  return sameOrigin
    ? `navegador → tienda    ${method} ${masked}`
    : `navegador → pasarela  ${method} ${masked} (directo, sin pasar por la tienda)`;
}

function maskToken(id) {
  return typeof id === "string" && id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

/** Lo que vale la pena ver de una respuesta: la orden, los bancos, el token o el estado. */
function summarize(body) {
  if (!body || typeof body !== "object") return "";
  if (body.order) {
    return `orden ${body.order.id} ${body.order.status}${body.redirectUrl ? " · redirige al banco" : ""}${body.error ? ` · ${body.error}` : ""}`;
  }
  if (Array.isArray(body.banks)) return `${body.banks.length} bancos`;
  if (body.publicKey) return "configuración pública del módulo de pagos";
  if (body.error) return typeof body.error === "string" ? body.error : JSON.stringify(body.error).slice(0, 120);
  const id = body.data?.id ?? body.id;
  const status = body.data?.status ?? body.status;
  if (id) return `id ${maskToken(id)}${status ? ` · ${status}` : ""}`;
  return "";
}

const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  const method = (init.method || "GET").toUpperCase();
  const parsed = new URL(url, window.location.href);
  const sameOrigin = parsed.origin === window.location.origin;
  const shownTarget = KEY_PATTERNS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    `${parsed.host}${parsed.pathname}`,
  );
  const started = performance.now();
  try {
    const response = await nativeFetch(input, init);
    const body = await response.clone().json().catch(() => undefined);
    const summary = summarize(body);
    const durationMs = Math.round(performance.now() - started);
    traceLine(`${describeCall(method, url)} → ${response.status}${summary ? ` · ${summary}` : ""} · ${durationMs} ms`);
    if (!sameOrigin) {
      monitor.log({
        stage: "browser",
        level: response.ok ? "ok" : "error",
        tag: "SDK-BROWSER→PASARELA",
        label: `${method} ${shownTarget}`,
        detail: `HTTP ${response.status}${summary ? ` · ${summary}` : ""} · directo sin pasar por la tienda`,
        durationMs,
      });
    }
    return response;
  } catch (error) {
    const durationMs = Math.round(performance.now() - started);
    traceLine(`${describeCall(method, url)} → sin respuesta: ${error.message}`);
    if (!sameOrigin) {
      monitor.log({
        stage: "browser",
        level: "error",
        tag: "SDK-BROWSER→PASARELA",
        label: `${method} ${shownTarget}`,
        detail: `Error de red: ${error.message}`,
        durationMs,
      });
    }
    throw error;
  }
};

const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

async function readJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `La tienda respondió ${response.status}`);
  return body;
}

function value(id) {
  return document.getElementById(id).value.trim();
}

function loadCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveCart(cart) {
  if (Object.keys(cart).length === 0) localStorage.removeItem(CART_KEY);
  else localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

function cartCount(cart) {
  return Object.values(cart).reduce((count, quantity) => count + quantity, 0);
}

function renderCount(cart) {
  const badge = document.getElementById("cart-count");
  if (badge) badge.textContent = String(cartCount(cart));
}

function setUpStore(form) {
  const catalog = JSON.parse(document.getElementById("catalog-data").textContent);
  const byId = new Map(catalog.map((product) => [product.id, product]));
  let cart = Object.fromEntries(
    Object.entries(loadCart()).filter(([id, quantity]) => byId.has(id) && Number.isInteger(quantity) && quantity > 0),
  );

  const lines = document.getElementById("cart-lines");
  const payButton = document.getElementById("pay-button");

  function setQuantity(id, quantity) {
    const next = { ...cart };
    const clamped = Math.min(MAX_QUANTITY, Math.max(0, quantity));
    if (clamped === 0) delete next[id];
    else next[id] = clamped;
    cart = next;
    saveCart(cart);
    render();
  }

  function lineItem(product, quantity) {
    const item = document.createElement("li");
    item.className = "line";
    const name = document.createElement("span");
    name.className = "line__name";
    name.textContent = product.title;
    const price = document.createElement("span");
    price.className = "line__price";
    price.textContent = pesos.format(product.priceInPesos * quantity);
    const detail = document.createElement("span");
    detail.className = "line__detail";
    detail.textContent = `${pesos.format(product.priceInPesos)} c/u`;
    const stepper = document.createElement("span");
    stepper.className = "stepper";
    const less = document.createElement("button");
    less.type = "button";
    less.textContent = "−";
    less.setAttribute("aria-label", `Quitar un ${product.title}`);
    less.addEventListener("click", () => setQuantity(product.id, quantity - 1));
    const count = document.createElement("span");
    count.textContent = String(quantity);
    const more = document.createElement("button");
    more.type = "button";
    more.textContent = "+";
    more.setAttribute("aria-label", `Agregar un ${product.title}`);
    more.disabled = quantity >= MAX_QUANTITY;
    more.addEventListener("click", () => setQuantity(product.id, quantity + 1));
    stepper.append(less, count, more);
    item.append(name, price, detail, stepper);
    return item;
  }

  function render() {
    const entries = catalog.filter((product) => cart[product.id] > 0);
    const total = entries.reduce((sum, product) => sum + product.priceInPesos * cart[product.id], 0);
    lines.replaceChildren(...entries.map((product) => lineItem(product, cart[product.id])));
    document.getElementById("cart-empty").hidden = entries.length > 0;
    document.getElementById("cart-totals").hidden = entries.length === 0;
    document.getElementById("subtotal").textContent = pesos.format(total);
    document.getElementById("total").textContent = pesos.format(total);
    form.hidden = entries.length === 0;
    payButton.textContent = `Pagar ${pesos.format(total)}`;
    for (const button of document.querySelectorAll(".add")) {
      const inCart = (cart[button.dataset.productId] ?? 0) > 0;
      button.classList.toggle("add--in-cart", inCart);
      button.textContent = inCart ? "Agregar otro" : "Agregar al pedido";
    }
    renderCount(cart);
  }

  for (const button of document.querySelectorAll(".add")) {
    button.addEventListener("click", () => setQuantity(button.dataset.productId, (cart[button.dataset.productId] ?? 0) + 1));
  }

  const cardFields = document.getElementById("card-fields");
  const hostedCard = document.getElementById("hosted-card");
  const pseFields = document.getElementById("pse-fields");
  const gatewaySelect = document.getElementById("gateway");
  // Los bancos de PSE son de cada pasarela: se piden una vez por pasarela.
  const banksByGateway = new Map();
  const DEFAULT_TEST_CARD = {
    number: "4242 4242 4242 4242",
    expMonth: "12",
    expYear: "30",
    cvc: "123",
    holder: "PEDRO PEREZ",
  };
  /* test-cards:start */
  const TEST_CARDS = {
    mercadopago: {
      number: "4013 5406 8274 6260",
      expMonth: "11",
      expYear: "30",
      cvc: "123",
      holder: "APRO Ruiz",
    },
  };
  /* test-cards:end */
  let lastCardGateway = null;

  function updateCardFieldsForGateway(gatewayId) {
    const card = TEST_CARDS[String(gatewayId).toLowerCase()] ?? DEFAULT_TEST_CARD;
    document.getElementById("cardNumber").value = card.number;
    document.getElementById("expMonth").value = card.expMonth;
    document.getElementById("expYear").value = card.expYear;
    document.getElementById("cvc").value = card.cvc;
    document.getElementById("cardHolder").value = card.holder;
  }

  function selectedGateway() {
    const option = gatewaySelect.selectedOptions[0];
    return { id: gatewaySelect.value, name: option?.textContent ?? "", cardCapture: option?.dataset.cardCapture };
  }

  function selectedMethod() {
    return form.querySelector("input[name=method]:checked").value;
  }

  async function loadPseBanks(gatewayId) {
    const select = document.getElementById("bankCode");
    select.replaceChildren(new Option("Cargando bancos…", ""));
    payButton.disabled = true;
    try {
      if (!banksByGateway.has(gatewayId)) {
        const { banks } = await readJson(await fetch(`/api/pse-banks?gateway=${encodeURIComponent(gatewayId)}`));
        banksByGateway.set(gatewayId, banks);
      }
      if (gatewaySelect.value !== gatewayId) return;
      select.replaceChildren(...banksByGateway.get(gatewayId).map((bank) => new Option(bank.name, bank.code)));
      payButton.disabled = false;
    } catch (error) {
      show(`No se pudo cargar la lista de bancos: ${error.message}`);
    }
  }

  /** Lo que se ve depende del medio y de la pasarela: hay pasarelas que reciben la tarjeta en su página. */
  function showMethod() {
    show("");
    const isPse = selectedMethod() === "PSE";
    const gateway = selectedGateway();
    const hosted = gateway.cardCapture === "HOSTED_PAGE";
    cardFields.hidden = isPse || hosted;
    hostedCard.hidden = isPse || !hosted;
    pseFields.hidden = !isPse;
    if (isPse) {
      loadPseBanks(gatewaySelect.value);
    } else {
      payButton.disabled = false;
      if (!hosted && gateway.id !== lastCardGateway) {
        updateCardFieldsForGateway(gateway.id);
        lastCardGateway = gateway.id;
      }
    }
  }

  form.addEventListener("change", (event) => {
    if (event.target.name === "method" || event.target.name === "gateway") showMethod();
  });

  form.addEventListener("input", () => {
    document.getElementById("buyer-summary").textContent = `${value("fullName")} · ${value("email")}`;
  });

  function cartTotal() {
    return catalog.reduce((sum, product) => sum + product.priceInPesos * (cart[product.id] ?? 0), 0);
  }

  async function cardMethod(gateway) {
    const installments = Number(value("installments")) || 1;
    if (gateway.cardCapture === "HOSTED_PAGE") {
      traceLine(`tarjeta: ${gateway.name} la recibe en su propia página; la tienda no la ve`);
      return { type: "CARD", installments };
    }
    traceLine("tarjeta: el módulo de pagos la tokeniza en el navegador; al servidor de la tienda solo llega el token");
    const config = await readJson(await fetch(`/api/payments/config?gateway=${encodeURIComponent(gateway.id)}`));
    const { tokenizeCard } = await import("/payments/client.js");
    const cardToken = await tokenizeCard(
      {
        number: value("cardNumber").replace(/\s+/g, ""),
        cvc: value("cvc"),
        expMonth: value("expMonth"),
        expYear: value("expYear"),
        cardHolder: value("cardHolder"),
        docType: value("documentType"),
        docNumber: value("documentNumber"),
      },
      // Hay pasarelas que atan el token al monto del cobro.
      { ...config, amountInPesos: String(cartTotal()) },
    );
    return { type: "CARD", cardToken, installments };
  }

  function pseMethod() {
    return { type: "PSE", bankCode: value("bankCode"), personType: value("personType") };
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    show("");
    payButton.disabled = true;
    payButton.textContent = "Procesando el pago…";
    let activeStage = "front";
    try {
      const selected = selectedMethod();
      const gateway = selectedGateway();
      const bottles = cartCount(cart);
      const total = cartTotal();
      monitor.open();
      monitor.resetStages();
      monitor.setStage("front", "active", "Preparando…");
      monitor.log({
        stage: "front",
        tag: "FRONT",
        label: `Iniciando pago con ${gateway.name}`,
        detail: `${bottles} ${bottles === 1 ? "botella" : "botellas"} · ${pesos.format(total)} · ${selected === "PSE" ? "PSE" : "Tarjeta"}`,
      });
      monitor.setStage("front", "ok", `${pesos.format(total)} · ${gateway.name}`);

      traceLine(`pagar ${bottles} ${bottles === 1 ? "botella" : "botellas"} con ${selected === "PSE" ? "PSE" : "tarjeta"} por ${gateway.name}`);

      let method;
      if (selected === "PSE") {
        activeStage = "browser";
        method = pseMethod();
        monitor.setStage("browser", "ok", "PSE · sin tarjeta");
        monitor.log({
          stage: "browser",
          tag: "FRONT",
          label: "Método PSE seleccionado",
          detail: `Banco código ${method.bankCode} (${method.personType}) · no requiere tokenización`,
        });
      } else if (gateway.cardCapture === "HOSTED_PAGE") {
        activeStage = "browser";
        method = await cardMethod(gateway);
        monitor.setStage("browser", "ok", "Página alojada");
        monitor.log({
          stage: "browser",
          tag: "SDK-BROWSER",
          label: "Tarjeta en página alojada",
          detail: `${gateway.name} recibe la tarjeta fuera de la tienda`,
        });
      } else {
        activeStage = "browser";
        monitor.setStage("browser", "active", "Tokenizando…");
        monitor.log({
          stage: "browser",
          tag: "SDK-BROWSER",
          label: "KitPagosBrowser.tokenizeCard()",
          detail: "Tarjeta permanece en el navegador; solicitando configuración pública",
        });
        method = await cardMethod(gateway);
        const tokenHint = maskToken(method.cardToken);
        monitor.setStage("browser", "ok", `Token ${tokenHint}`);
        monitor.log({
          stage: "browser",
          level: "ok",
          tag: "SDK-BROWSER",
          label: "Tokenización completada",
          detail: `Token ${tokenHint} generado · número de tarjeta y CVV no salieron al backend`,
        });
      }

      activeStage = "backend";
      monitor.setStage("backend", "active", "POST /api/orders…");
      monitor.setStage("sandbox", "active", "Esperando…");
      monitor.log({
        stage: "backend",
        tag: "FRONT→BACK",
        label: "POST /api/orders",
        detail:
          method.type === "PSE"
            ? `Envía orden PSE (banco ${method.bankCode})`
            : method.cardToken
              ? `Envía solo token ${maskToken(method.cardToken)} (cero datos sensibles de tarjeta)`
              : "Envía intención de cobro en página alojada",
      });

      const payer = {
        fullName: value("fullName"),
        email: value("email"),
        documentType: value("documentType"),
        documentNumber: value("documentNumber"),
        phone: value("phone"),
        address: {
          streetName: value("streetName"),
          streetNumber: value("streetNumber"),
          neighborhood: value("neighborhood"),
          city: value("city"),
          zipCode: value("zipCode"),
        },
      };
      const items = Object.entries(cart).map(([productId, quantity]) => ({ productId, quantity }));
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gateway: gateway.id, payer, method, items }),
      });
      const body = await response.json().catch(() => ({}));
      if (Array.isArray(body.trace)) {
        monitor.appendBackendTrace(body.trace);
      }
      if (!body.order) throw new Error(body.error || `La tienda respondió ${response.status}`);
      // El carrito se queda hasta que la orden se apruebe: si el pago se rechaza, se reintenta sin armarlo otra vez.
      const destination = body.redirectUrl || `/orders/${body.order.id}`;
      const destinationLabel = body.redirectUrl
        ? `Redirigiendo a ${new URL(body.redirectUrl).host} para completar el pago…`
        : `Orden ${body.order.id} lista (${body.order.status}). Abrir detalle…`;
      monitor.log({
        stage: "response",
        level: body.redirectUrl ? "warn" : "ok",
        tag: "TIENDA",
        label: body.redirectUrl ? "Redirección requerida" : `Orden ${body.order.id} lista`,
        detail: body.redirectUrl ? new URL(body.redirectUrl).host : `/orders/${body.order.id}`,
      });
      traceLine(body.redirectUrl ? `redirigiendo a otra página para pagar: ${new URL(body.redirectUrl).host}` : `abriendo la orden ${body.order.id}`);
      if (monitor.shouldPause()) {
        payButton.textContent = "Esperando continuar…";
        await monitor.waitForContinue(destinationLabel);
      }
      window.location.assign(destination);
    } catch (error) {
      monitor.setStage(activeStage, "error", "Error");
      monitor.log({
        stage: activeStage,
        level: "error",
        tag: "ERROR",
        label: "Fallo en el flujo de pago",
        detail: error.message,
      });
      show(`No se pudo completar el pago: ${error.message}`);
      payButton.disabled = false;
      render();
    }
  });

  render();
  showMethod();
}

async function refreshOrder(orderId) {
  const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}`);
  const body = await response.json().catch(() => ({}));
  if (Array.isArray(body.trace)) {
    monitor.appendBackendTrace(body.trace);
  }
  if (!response.ok) {
    monitor.setStage("response", "error", `HTTP ${response.status}`);
    throw new Error(body.error || `La tienda respondió ${response.status}`);
  }
  monitor.setStage("front", "ok", `Orden ${orderId}`);
  return body.order.status;
}

function setUpOrderPage(button) {
  const shown = document.getElementById("order-result").dataset.status;
  traceLine(`orden ${button.dataset.orderId}: ${shown}${shown === "PENDING" ? "; la página la consulta sola" : ""}`);
  monitor.log({
    stage: "response",
    level: shown === "APPROVED" ? "ok" : shown === "PENDING" ? "warn" : "error",
    tag: "ORDEN",
    label: `Orden ${button.dataset.orderId} cargada`,
    detail: `Estado actual: ${shown}`,
  });
  if (shown === "APPROVED") saveCart({});
  renderCount(loadCart());

  button.addEventListener("click", async () => {
    show("Consultando…");
    monitor.open();
    monitor.setStage("front", "ok", `Orden ${button.dataset.orderId}`);
    monitor.setStage("browser", "idle", "No aplica");
    monitor.setStage("backend", "active", "Consultando…");
    monitor.setStage("sandbox", "active", "Esperando…");
    try {
      const nextStatus = await refreshOrder(button.dataset.orderId);
      if (monitor.shouldPause()) {
        await monitor.waitForContinue(`Consulta finalizada (${nextStatus}). Recargar orden…`);
      }
      window.location.reload();
    } catch (error) {
      show(`No se pudo consultar el estado: ${error.message}`);
    }
  });

  // Al volver del banco el pago suele seguir en proceso: se consulta solo hasta que cambie.
  if (shown !== "PENDING") return;
  let attempts = 0;
  const timer = setInterval(async () => {
    attempts += 1;
    try {
      const status = await refreshOrder(button.dataset.orderId);
      if (status !== shown) {
        clearInterval(timer);
        window.location.reload();
        return;
      }
    } catch {
      // La siguiente vuelta lo intenta otra vez; el botón queda para hacerlo a mano.
    }
    if (attempts >= POLL_ATTEMPTS) clearInterval(timer);
  }, POLL_INTERVAL_MS);
}

function setUpOrdersList() {
  const ordersMessage = document.getElementById("orders-message");
  const buttons = document.querySelectorAll("button[data-refresh-order]");
  for (const button of buttons) {
    button.addEventListener("click", async () => {
      const orderId = button.dataset.refreshOrder;
      if (ordersMessage) ordersMessage.textContent = "";
      button.disabled = true;
      button.textContent = "Consultando…";
      monitor.open();
      monitor.setStage("front", "ok", `Orden ${orderId}`);
      monitor.setStage("browser", "idle", "No aplica");
      monitor.setStage("backend", "active", "Consultando…");
      monitor.setStage("sandbox", "active", "Esperando…");
      try {
        const nextStatus = await refreshOrder(orderId);
        if (monitor.shouldPause()) {
          await monitor.waitForContinue(`Consulta de ${orderId} (${nextStatus}). Recargar lista…`);
        }
        window.location.reload();
      } catch (error) {
        if (ordersMessage) ordersMessage.textContent = `No se pudo consultar ${orderId}: ${error.message}`;
        button.disabled = false;
        button.textContent = "Consultar estado";
      }
    });
  }
}

renderCount(loadCart());

const form = document.getElementById("checkout-form");
if (form) setUpStore(form);

const refresh = document.getElementById("refresh-order");
if (refresh) setUpOrderPage(refresh);

setUpOrdersList();
