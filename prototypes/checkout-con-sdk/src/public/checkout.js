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
  const started = performance.now();
  try {
    const response = await nativeFetch(input, init);
    const body = await response.clone().json().catch(() => undefined);
    const summary = summarize(body);
    traceLine(`${describeCall(method, url)} → ${response.status}${summary ? ` · ${summary}` : ""} · ${Math.round(performance.now() - started)} ms`);
    return response;
  } catch (error) {
    traceLine(`${describeCall(method, url)} → sin respuesta: ${error.message}`);
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
  const pseFields = document.getElementById("pse-fields");
  let banksLoaded = false;

  async function loadPseBanks() {
    const select = document.getElementById("bankCode");
    select.replaceChildren(new Option("Cargando bancos…", ""));
    payButton.disabled = true;
    try {
      const { banks } = await readJson(await fetch("/api/pse-banks"));
      select.replaceChildren(...banks.map((bank) => new Option(bank.name, bank.code)));
      payButton.disabled = false;
    } catch (error) {
      banksLoaded = false;
      show(`No se pudo cargar la lista de bancos: ${error.message}`);
    }
  }

  form.addEventListener("change", (event) => {
    if (event.target.name !== "method") return;
    const isPse = event.target.value === "PSE";
    cardFields.hidden = isPse;
    pseFields.hidden = !isPse;
    if (isPse && !banksLoaded) {
      banksLoaded = true;
      loadPseBanks();
    } else {
      payButton.disabled = isPse && !document.getElementById("bankCode").value;
    }
  });

  form.addEventListener("input", () => {
    document.getElementById("buyer-summary").textContent = `${value("fullName")} · ${value("email")}`;
  });

  async function cardMethod() {
    traceLine("tarjeta: el módulo de pagos la tokeniza en el navegador; al servidor de la tienda solo llega el token");
    const config = await readJson(await fetch("/api/payments/config"));
    const { tokenizeCard } = await import("/payments/client.js");
    const cardToken = await tokenizeCard(
      {
        number: value("cardNumber").replace(/\s+/g, ""),
        cvc: value("cvc"),
        expMonth: value("expMonth"),
        expYear: value("expYear"),
        cardHolder: value("cardHolder"),
      },
      config,
    );
    return { type: "CARD", cardToken, installments: Number(value("installments")) || 1 };
  }

  function pseMethod() {
    return { type: "PSE", bankCode: value("bankCode"), personType: value("personType") };
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    show("");
    payButton.disabled = true;
    payButton.textContent = "Procesando el pago…";
    try {
      const selected = form.querySelector("input[name=method]:checked").value;
      const bottles = cartCount(cart);
      traceLine(`pagar ${bottles} ${bottles === 1 ? "botella" : "botellas"} con ${selected === "PSE" ? "PSE" : "tarjeta"}`);
      const method = selected === "PSE" ? pseMethod() : await cardMethod();
      const payer = {
        fullName: value("fullName"),
        email: value("email"),
        documentType: value("documentType"),
        documentNumber: value("documentNumber"),
        phone: value("phone"),
      };
      const items = Object.entries(cart).map(([productId, quantity]) => ({ productId, quantity }));
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payer, method, items }),
      });
      const body = await response.json().catch(() => ({}));
      if (!body.order) throw new Error(body.error || `La tienda respondió ${response.status}`);
      // El carrito se queda hasta que la orden se apruebe: si el pago se rechaza, se reintenta sin armarlo otra vez.
      traceLine(body.redirectUrl ? `redirigiendo a la página del banco: ${new URL(body.redirectUrl).host}` : `abriendo la orden ${body.order.id}`);
      window.location.assign(body.redirectUrl || `/orders/${body.order.id}`);
    } catch (error) {
      show(`No se pudo completar el pago: ${error.message}`);
      payButton.disabled = false;
      render();
    }
  });

  render();
}

async function refreshOrder(orderId) {
  const { order } = await readJson(await fetch(`/api/orders/${encodeURIComponent(orderId)}`));
  return order.status;
}

function setUpOrderPage(button) {
  const shown = document.getElementById("order-result").dataset.status;
  traceLine(`orden ${button.dataset.orderId}: ${shown}${shown === "PENDING" ? "; la página la consulta sola" : ""}`);
  if (shown === "APPROVED") saveCart({});
  renderCount(loadCart());

  button.addEventListener("click", async () => {
    show("Consultando…");
    try {
      await refreshOrder(button.dataset.orderId);
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

const form = document.getElementById("checkout-form");
if (form) setUpStore(form);

const refresh = document.getElementById("refresh-order");
if (refresh) setUpOrderPage(refresh);
